# 支持打开无 VCS 仓库的文件夹 (folder workspace)

**状态**: 草案
**作者**: Claude (Opus 4.7)
**日期**: 2026-04-21

## 背景

当前 desktop 仅支持打开 Git/jj 仓库目录：

- `projects.openNew` / `openFromPath` 调用 `getRepoRoot(selectedPath)`，未找到 `.git` / `.jj` 时抛 `NotGitRepoError`
- 用户被引导至 `InitGitDialog`，只能选 **"Initialize Git"** 或 **"Cancel"**
- `initGitAndOpen` 只做 `git init` + 空 commit，无 jj colocate

需求：允许"打开一个不是仓库的目录"，并把终端等基础能力带起来；同时把初始化默认行为改为 `git + jj colocated`。

## 目标

1. 允许把任意目录作为 `folder` 型项目/workspace 打开（无 VCS 也可用终端、文件树）
2. "初始化仓库" 按钮的语义改为：`git init` + `jj git init --colocate`
3. folder 项目详情页保留 VCS 面板（分支 / DAG / commit 等）但置灰，提示"未初始化 git"
4. folder 可就地升级为 git+jj 仓库（不换 project、不丢 tab 状态）
5. 现有带仓库流程保持兼容，不改已有用户体验

## 非目标

- 独立的 "New Terminal" 菜单/入口（下一期）
- folder 型 project 的跨设备同步/云
- 仅初始化 git、不初始化 jj 的选项（统一默认走 colocated）

## 数据模型变更

### `packages/local-db/src/schema/schema.ts`

```diff
 export const workspaces = sqliteTable("workspaces", {
   ...
   type: text("type").notNull().$type<WorkspaceType>(),
-  branch: text("branch").notNull(),
+  branch: text("branch"),            // folder workspace 为 null
   ...
 });
```

- `projects.defaultBranch` / `projects.vcsType` 已允许 null，无需改动
- `workspaces.worktreeId` 已允许 null

### `packages/local-db/src/schema/zod.ts`

```diff
-export const workspaceTypeSchema = z.enum(["worktree", "branch"]);
+export const workspaceTypeSchema = z.enum(["worktree", "branch", "folder"]);
```

### Drizzle migration

按规则不手写 SQL，用：

```bash
cd packages/db && bunx drizzle-kit generate --name="workspace_type_folder"
```

需要用户自行在一条新的 neon 分支上跑 generate（本仓库局部 db 是 sqlite，看 `packages/local-db` 的 drizzle 配置）。

**迁移兼容性**：旧行 `branch` 原值保留；新加 `folder` 值不影响旧查询。零停机。

## 后端改动 (`apps/desktop/src/lib/trpc/routers/projects/projects.ts`)

### 新增 `openAsFolder`

```typescript
openAsFolder: publicProcedure
  .input(z.object({ path: z.string() }))
  .mutation(async ({ input }) => {
    const stats = statSync(input.path);
    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory");
    }

    const project = upsertFolderProject(input.path);
    await ensureFolderWorkspace(project);

    track("project_opened", {
      project_id: project.id,
      method: "folder",
    });

    return { project };
  }),
```

- `upsertFolderProject(path)`: 类似 `upsertProject`，但 `defaultBranch=null`, `vcsType=null`
- `ensureFolderWorkspace(project)`: 新建 `type="folder", branch=null, worktreeId=null, name=项目名`

### 改造 `initGitAndOpen` → `initRepoAndOpen`

签名：`{ path: string, alreadyOpened?: boolean }`

逻辑：

1. `initGitRepo(path)` (保留)
2. `await jjGitInitColocate(path)` (新增 helper，见下)
3. 若 `alreadyOpened=true`（folder 升级场景）：
   - 找已有 project + folder workspace
   - `project.vcsType = "jj"`, `project.defaultBranch = defaultBranch`
   - `workspace.type = "branch"`, `workspace.branch = defaultBranch`
4. 否则走现有 `upsertProject` + `ensureMainWorkspace`

别名保留 `initGitAndOpen` 为 `initRepoAndOpen` 的薄包装，避免外部调用者破坏。或直接重命名 + 全仓替换（倾向后者，避免歧义）。

### 新 helper `jjGitInitColocate(path)`

放 `src/lib/trpc/routers/projects/projects.ts` 或 `workspaces/utils/vcs/jj-provider.ts`。

```typescript
async function jjGitInitColocate(path: string): Promise<void> {
  await execWithShellEnv("jj", ["git", "init", "--colocate"], { cwd: path });
}
```

- 前置：`path` 下 `.git` 已存在（由 `initGitRepo` 创建）
- `--colocate` 让 jj 与 git 共用同一 working copy
- 失败时 throw，调用方决定是否回滚（初版暂不回滚，只提示错误）

### `openNew` / `openFromPath` 返回值

保持不变（继续返回 `needsGitInit`）。选项分叉在 **dialog 层**做，不在 server 层。

### 新增 `upgradeFolderToRepo(projectId)`

```typescript
upgradeFolderToRepo: publicProcedure
  .input(z.object({ projectId: z.string() }))
  .mutation(async ({ input }) => {
    const project = localDb.select().from(projects)
      .where(eq(projects.id, input.projectId)).get();
    if (!project) throw new Error("Project not found");

    await initGitRepo(project.mainRepoPath);
    await jjGitInitColocate(project.mainRepoPath);

    const vcs = getVcsProvider(project.mainRepoPath);
    const defaultBranch = await vcs.getDefaultBranch(project.mainRepoPath);

    localDb.update(projects).set({
      vcsType: "jj",
      defaultBranch,
    }).where(eq(projects.id, project.id)).run();

    localDb.update(workspaces).set({
      type: "branch",
      branch: defaultBranch,
    }).where(and(
      eq(workspaces.projectId, project.id),
      eq(workspaces.type, "folder"),
    )).run();

    return { ok: true };
  }),
```

## 终端 / cwd 上下文适配

### `apps/desktop/src/lib/trpc/routers/terminal/utils/workspace-terminal-context.ts`

```diff
 workspacePath:
-  row.workspace.type === "branch"
-    ? (row.mainRepoPath ?? undefined)
-    : (row.worktreePath ?? undefined),
+  row.workspace.type === "worktree"
+    ? (row.worktreePath ?? undefined)
+    : (row.mainRepoPath ?? undefined),
```

即 `branch` 和 `folder` 都走 `mainRepoPath`。

### `createOrAttach` 中的 `assertWorkspaceUsable`

`folder` 不做 VCS 校验，直接允许。

## 前端改动

### `InitGitDialog.tsx`

三按钮：

- **Cancel**（保留）
- **Open as folder** — 新增：调 `projects.openAsFolder` 逐个路径
- **Initialize jj repo**（文案改）— 调 `projects.initGitAndOpen`（含 jj colocate）

Store `useGitInitDialogStore` 扩：

```typescript
interface GitInitDialogState {
  open: (params: {
    paths: string[];
    onInit: () => Promise<void>;
    onOpenAsFolder: () => Promise<void>;
    onCancel: () => void;
  }) => void;
  // ...
}
```

`useOpenProject.tsx` 的 `showDialog` 组装：

- `onInit`: 现有 initGitAndOpen 循环
- `onOpenAsFolder`: 循环调 `openAsFolder`
- `onCancel`: 保留

### Sidebar / 项目详情

组件 `WorkspaceRow` / `WorkspaceList` 对 `type === "folder"`：

- 图标：文件夹图标（非分支图标）
- 不显示 branch 名

VCS 相关面板（branches list / commits / DAG）挂上读取 `workspace.type`：

- `type === "folder"` → 渲染一个 disabled 态 + "This folder is not a git repository. Initialize it?" 按钮
- 点按钮调 `projects.upgradeFolderToRepo(projectId)`

具体文件：

- `renderer/screens/.../BranchesPanel` / `DagPanel` / `CommitsPanel`（位置待进一步确认）
- 统一 pattern：包一层 `<FolderProjectGuard projectId={...}>` 组件

### StartView "Open Project" 按钮

无需改文案，行为上 `openNew` 的结果仍会触发 InitGitDialog 三选。

## 测试

### 单元 / 集成

- `projects.openAsFolder`: 输入 `/tmp/no-git`（确保无 `.git`/`.jj`），断言 project 插入且 vcsType=null、workspace.type="folder"、branch=null
- `projects.initGitAndOpen` 升级路径：mock `initGitRepo` + `jjGitInitColocate`，确认 project 和 workspace 被正确更新
- `upgradeFolderToRepo`: folder project 升级后 workspace.type="branch"、project.vcsType="jj"

### 手测 (desktop app)

1. 选一个纯净空目录 → 三按钮弹出
2. 点 "Open as folder" → tab 打开，终端可用，VCS 面板置灰，分支不显示
3. 再点 "Initialize jj repo" 按钮 → 成功后面板解禁，jj log 能跑
4. 终端中 `jj st` / `git st` 都正常（证明 colocate）
5. 现有 git 项目打开流程不受影响
6. 拖拽无 git 目录进 desktop → 同样弹三选

### 回归

- 所有 `workspace.type === "branch"` / `"worktree"` 的 switch 都加 `folder` 分支或 fallthrough，避免 exhaustive check 报错
- `bun run typecheck`、`bun test --filter desktop`

## 构建顺序

1. schema + zod + drizzle migration（一次提交）
2. server: `openAsFolder` + 重构 `initGitAndOpen` + `upgradeFolderToRepo` + jj helper
3. terminal utils 补 `folder` 分支
4. renderer: store → dialog 三按钮 → useOpenProject → sidebar/面板 guard → upgrade 按钮
5. 手测 + 回归测

每步单独 jj commit，便于 bisect。

## 风险 / 未决

- **jj 不可用场景**：用户机器没装 jj 或 `jj git init --colocate` 失败 → 初始化按钮应降级为仅 git？本期选择 hard-fail 并提示用户安装 jj（文案："Install jj first: https://jj-vcs.github.io/jj/"）。如后续反馈多可加可选
- **folder workspace.branch=null** 带来的 `branch` 列查询：需审计所有 `SELECT branch FROM workspaces` 处，确保不崩
- **Pane / tab 已存在场景**：folder → repo 升级后 tab 不重建，workspace row update 自然生效
- **现有 project 已经是 folder（历史数据）**：无，此表新增 type 值，旧行都是 branch/worktree

## 变更文件清单

```
packages/local-db/src/schema/schema.ts                       改
packages/local-db/src/schema/zod.ts                          改
packages/local-db/drizzle/<new>.sql                          生成
apps/desktop/src/lib/trpc/routers/projects/projects.ts       改 + 新 proc
apps/desktop/src/lib/trpc/routers/workspaces/utils/vcs/jj-provider.ts 可选，放 helper
apps/desktop/src/lib/trpc/routers/terminal/utils/workspace-terminal-context.ts 改
apps/desktop/src/lib/trpc/routers/terminal/terminal.ts       改（assertWorkspaceUsable 分支）
apps/desktop/src/renderer/stores/git-init-dialog.ts          扩 store
apps/desktop/src/renderer/react-query/projects/InitGitDialog.tsx 三按钮
apps/desktop/src/renderer/react-query/projects/useOpenProject.tsx dialog 组装
apps/desktop/src/renderer/screens/.../BranchesPanel.tsx      folder guard
apps/desktop/src/renderer/screens/.../CommitsPanel.tsx       folder guard
apps/desktop/src/renderer/screens/.../DagPanel.tsx           folder guard
apps/desktop/src/renderer/screens/.../WorkspaceRow.tsx       folder 图标
(其他 switch/exhaustive 处按 typecheck 结果补)
```
