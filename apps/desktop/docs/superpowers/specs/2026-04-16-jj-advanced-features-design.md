# Jujutsu (jj) Advanced Features — Design Spec

**Date:** 2026-04-16
**Scope:** apps/desktop — jj VCS integration enhancements
**Upstream strategy:** Fork with periodic sync; minimize changes to existing files, prefer new files

---

## 1. Overview

Add five features to the desktop app's jj integration:

| # | Feature | Size | Dependencies |
|---|---------|------|-------------|
| 2 | Change navigation (`jj edit`) | S | None |
| 5 | Bookmark management (CRUD + move) | S | None |
| 3 | Squash/Rebase to arbitrary change | M | Soft dep on #2 (RevisionRow) |
| 4 | Conflict resolution UI | M | None |
| 1 | Revision DAG visualization | XL | Lane algorithm + SVG rendering |

Execution order: 0 (infra) → 2 → 5 → 3 → 4 → 1

---

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Lock strategy | Shared `withJjRepoLock` utility | Eliminates store-lock contention between jj-change-status.ts queries and new mutations |
| #2 interaction | Hover actions + right-click context menu | Both quick access and full menu; user preference |
| #5 scope | CRUD + move | Covers daily usage without remote tracking complexity |
| #4 conflict mode | Embedded 3-way diff editor | Best UX; CodeMirror merge if available |
| #1 DAG scope | `(::@ \| bookmarks()) ~ ::trunk()` | Shows own work + unmerged bookmark heads |
| #1 DAG vs History | DAG replaces History section | Richer information, interactive, no need for both |

---

## 3. Infrastructure (Step 0)

### 3.1 Shared Repo Lock

**New file:** `src/lib/trpc/routers/changes/utils/jj-repo-lock.ts`

```typescript
const repoLocks = new Map<string, Promise<unknown>>();

export async function withJjRepoLock<T>(
  repoPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = repoLocks.get(repoPath) ?? Promise.resolve();
  const next = prev.then(fn, fn) as Promise<T>;
  repoLocks.set(repoPath, next);
  try {
    return await next;
  } finally {
    if (repoLocks.get(repoPath) === next) repoLocks.delete(repoPath);
  }
}
```

### 3.2 Shared CLI Helper

**New file:** `src/lib/trpc/routers/changes/utils/jj-cli.ts`

```typescript
import { execWithShellEnv } from "../../workspaces/utils/shell-env";
import { withJjRepoLock } from "./jj-repo-lock";

export async function jj(repoPath: string, args: string[]): Promise<string> {
  return withJjRepoLock(repoPath, async () => {
    const { stdout } = await execWithShellEnv(
      "jj",
      ["--no-pager", "--color=never", "-R", repoPath, ...args],
      { cwd: repoPath },
    );
    return stdout.trim();
  });
}
```

### 3.3 Migration of Existing Code

- **`jj-provider.ts`**: Delete internal `repoLocks` map and `withRepoLock` function. Import `withJjRepoLock` from shared utility. Minimal diff.
- **`jj-change-status.ts`**: Delete local `jj()` helper. Import from `jj-cli.ts`. All existing queries automatically gain lock serialization.

---

## 4. Feature #2 — Change Navigation (`jj edit`)

### 4.1 Backend

**New file:** `src/lib/trpc/routers/changes/jj-mutations.ts`

```typescript
jjEdit: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    changeId: z.string(),
  }))
  .mutation(async ({ input }) => {
    assertRegisteredWorktree(input.worktreePath);
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    await jj(repoRoot, ["edit", input.changeId]);
    clearStatusCacheForWorktree(input.worktreePath);
    return { success: true as const };
  })
```

### 4.2 Frontend

**New file:** `JjChangesView/components/RevisionRow/RevisionRow.tsx`

Extract from JjChangesView's inline ancestor rendering. Adds:

- **Hover actions**: Edit button (pencil icon) appears on hover
- **Context menu** (right-click): "Edit this change"
- **Current `@` indicator**: Highlighted, edit button disabled
- **Loading state**: Disabled while mutation is pending

**Interaction flow:**
1. User hovers ancestor row → edit button appears
2. Click / right-click → "Edit this change"
3. Call `jjEdit` mutation
4. On success → `refetch()` updates entire view (new `@`)
5. On error → toast with jj error message

**Edge cases:**
- Edit while description textarea is dirty → auto-describe on blur (existing logic) fires before edit
- Edit a conflicted revision → jj returns error, shown in toast
- Edit the current `@` → button disabled, menu item grayed out

### 4.3 Move Existing Mutations

Move `jjDescribe`, `jjCommit`, `jjSquash`, `jjDiscardFile`, `jjDiscardAll` from `jj-change-status.ts` to `jj-mutations.ts`. The query (`jjGetChangeStatus`) stays in `jj-change-status.ts`.

---

## 5. Feature #5 — Bookmark Management

### 5.1 Backend

Add to `jj-mutations.ts`:

```typescript
// Create bookmark at revision (default: @)
jjBookmarkCreate: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    name: z.string().regex(/^[a-zA-Z0-9._\/-]+$/),
    revision: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    const args = ["bookmark", "create", input.name];
    if (input.revision) args.push("-r", input.revision);
    await jj(repoRoot, args);
    clearStatusCacheForWorktree(input.worktreePath);
    return { success: true as const };
  })

// Delete bookmark
jjBookmarkDelete: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    name: z.string(),
  }))
  .mutation(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    await jj(repoRoot, ["bookmark", "forget", input.name]);
    clearStatusCacheForWorktree(input.worktreePath);
    return { success: true as const };
  })

// Rename bookmark (forget + create at same revision)
// Note: forget is local-only. If the old bookmark was pushed to a remote,
// the remote copy remains. A subsequent push will create the new name on
// the remote, but the old name must be deleted separately (out of scope).
jjBookmarkRename: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    oldName: z.string(),
    newName: z.string().regex(/^[a-zA-Z0-9._\/-]+$/),
  }))
  .mutation(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    // Get the revision the old bookmark points to
    const rev = await jj(repoRoot, [
      "log", "-r", `${input.oldName}`, "--no-graph", "-T", "change_id",
    ]);
    await jj(repoRoot, ["bookmark", "forget", input.oldName]);
    await jj(repoRoot, ["bookmark", "create", input.newName, "-r", rev]);
    clearStatusCacheForWorktree(input.worktreePath);
    return { success: true as const };
  })

// Move bookmark to revision
jjBookmarkMove: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    name: z.string(),
    revision: z.string(),
  }))
  .mutation(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    await jj(repoRoot, ["bookmark", "set", input.name, "-r", input.revision]);
    clearStatusCacheForWorktree(input.worktreePath);
    return { success: true as const };
  })
```

### 5.2 Frontend

**RevisionRow context menu extensions:**
- "Create bookmark here" → inline input (popover with text field)
- "Move bookmark here" → submenu listing existing bookmarks

**Bookmark badge interactions (on RevisionRow):**
- Right-click on bookmark badge → "Rename" / "Delete"
- Rename → inline edit (double-click or context menu)

**Header area (JjChangesView top bar):**
- Current `@` bookmark badge → click to show management dropdown

**Validation:**
- Bookmark name regex: `^[a-zA-Z0-9._\/-]+$`
- Duplicate name check: client-side warning before mutation

---

## 6. Feature #3 — Squash/Rebase to Arbitrary Change

### 6.1 Backend

Add to `jj-mutations.ts`:

```typescript
// Squash current working copy into a specific target
jjSquashInto: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    targetChangeId: z.string(),
    message: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    const args = ["squash", "--into", input.targetChangeId];
    if (input.message) args.push("-m", input.message);
    else args.push("-m", ""); // Prevent interactive editor
    await jj(repoRoot, args);
    clearStatusCacheForWorktree(input.worktreePath);
    return { success: true as const };
  })

// Rebase entire branch to new destination
// Uses -b @ -d <dest> per jj-only policy (never -r)
jjRebase: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    destination: z.string(),
  }))
  .mutation(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    await jj(repoRoot, ["rebase", "-b", "@", "-d", input.destination]);
    clearStatusCacheForWorktree(input.worktreePath);
    return { success: true as const };
  })
```

### 6.2 Frontend

**RevisionRow context menu extensions:**
- "Squash @ into this change" → confirmation dialog with optional message input
- "Rebase onto this change" → confirmation dialog

**Confirmation dialogs** are required because these operations are destructive (modify history). Each dialog shows:
- Source and target change IDs
- Warning text explaining the operation
- Cancel / Confirm buttons

---

## 7. Feature #4 — Conflict Resolution UI

### 7.1 Backend

**New file:** `src/lib/trpc/routers/changes/jj-conflicts.ts`

```typescript
// List conflicted files
jjConflictList: publicProcedure
  .input(z.object({ worktreePath: z.string() }))
  .query(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    const output = await jj(repoRoot, ["resolve", "--list"]);
    return parseConflictList(output); // → { path: string }[]
  })

// Get 3-way conflict content for a file
jjConflictContent: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    filePath: z.string(),
  }))
  .query(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    const fullPath = path.join(repoRoot, input.filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    return parseJjConflictMarkers(content);
    // → { base: string, left: string, right: string, raw: string }
  })

// Resolve: write user's merged content to file
jjConflictResolve: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    filePath: z.string(),
    resolvedContent: z.string(),
  }))
  .mutation(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    const fullPath = path.join(repoRoot, input.filePath);
    await fs.writeFile(fullPath, input.resolvedContent, "utf-8");
    // jj auto-tracks the file change, conflict markers removed = resolved
    clearStatusCacheForWorktree(input.worktreePath);
    return { success: true as const };
  })
```

### 7.2 jj Conflict Marker Parser

**New file:** `JjChangesView/components/ConflictEditor/conflict-parser.ts`

jj uses a different conflict marker format than git:

```
<<<<<<< Conflict 1 of N
+++++++ Contents of side #1
<left content>
------- Contents of base
<base content>
+++++++ Contents of side #2
<right content>
>>>>>>>
```

Parser extracts `{ base, left, right }` for each conflict region. Non-conflict regions are passed through as-is.

### 7.3 Frontend

**New file:** `JjChangesView/components/ConflictEditor/ConflictEditor.tsx`

**Layout:**
- 3-panel side-by-side: Left (side #1) | Center (result/edit) | Right (side #2)
- Base content shown as diff markers in center panel
- Editor: CodeMirror 6 with `@codemirror/merge` extension
  - Fallback: If `@codemirror/merge` is not available, use simple side-by-side readonly panels + editable center

**Integration into JjChangesView:**
- When `hasConflicts === true`, show yellow warning bar at top: "N files have conflicts"
- Clicking a conflicted file opens ConflictEditor instead of normal diff view
- After resolving all conflicts, warning bar disappears on next refetch

**Conflict file indicators:**
- In the Changes file list, conflicted files get a special icon (warning triangle)
- File status shows as "conflicted" instead of "modified"

---

## 8. Feature #1 — Revision DAG Visualization

### 8.1 Backend

**New file:** `src/lib/trpc/routers/changes/jj-dag.ts`

```typescript
export interface DagNode {
  changeId: string;
  commitId: string;
  shortCommitId: string;
  description: string;
  bookmarks: string[];
  author: string;
  timestamp: string;
  parentChangeIds: string[];
  isWorkingCopy: boolean;
  isEmpty: boolean;
  hasConflicts: boolean;
}

jjGetDag: publicProcedure
  .input(z.object({
    worktreePath: z.string(),
    baseBookmark: z.string().optional(),
  }))
  .query(async ({ input }) => {
    const repoRoot = findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
    const baseBookmark = input.baseBookmark ?? "main";
    const baseRef = await resolveBaseRef(repoRoot, baseBookmark);

    // Revset: own work + unmerged bookmark heads
    const revset = `(::@ | bookmarks()) ~ ::${baseRef}`;

    const DAG_TEMPLATE = [
      'change_id.shortest()',
      'commit_id',
      'commit_id.short(7)',
      'description.first_line()',
      'bookmarks',
      'author.name()',
      'author.timestamp().format("%Y-%m-%dT%H:%M:%S%z")',
      'parents.map(|p| p.change_id.shortest()).join(",")',
      'self.working_copies()',
      'empty',
      'conflict',
    ].join(' ++ "\\t" ++ ');

    const output = await jj(repoRoot, [
      "log", "-r", revset, "--no-graph",
      "-T", `${DAG_TEMPLATE} ++ "\\n"`,
    ]);

    return parseDagOutput(output);
    // → DagNode[]
  })
```

**Node limit:** If output exceeds 50 nodes, truncate and indicate "N more revisions not shown".

### 8.2 Frontend — Layout Algorithm

**New file:** `JjChangesView/components/RevisionDag/dag-layout.ts`

**Algorithm:** Simple greedy lane assignment

```
Input: DagNode[] (topologically sorted, newest first)
Output: { node: DagNode, lane: number, y: number, connections: Connection[] }[]

1. For each node (newest → oldest):
   a. If node has a child already placed, inherit child's lane
   b. If node has multiple children in different lanes, pick leftmost
   c. If no child yet (head), assign next available lane
2. Draw connections: parent→child as SVG paths
   - Same lane: straight vertical line
   - Different lanes: curved bezier connecting lanes
3. Merge nodes (multiple parents): draw all parent connections
```

### 8.3 Frontend — SVG Rendering

**New file:** `JjChangesView/components/RevisionDag/RevisionDag.tsx`

**Layout:** Vertical, newest at top

Each row (height: ~32px):
```
[lane lines] | [node dot] | [change_id] [description] [bookmark badges]
```

**Node styling:**
- `@` (working copy): filled blue circle, row highlighted
- Empty revision: hollow circle, dimmed text
- Conflicted: orange circle with warning icon
- Normal: filled gray circle

**Lane lines:** SVG `<path>` elements
- Straight segments: vertical lines in lane color
- Cross-lane connections: cubic bezier curves
- Colors: rotate through 6-8 distinct colors per lane

**Interactions:**
- Click node → `jjEdit` mutation (navigate to that change)
- Hover → tooltip with full details (author, timestamp, full description)
- Right-click → context menu (same as RevisionRow: edit, bookmark, squash, rebase)

**Integration:** Replaces the History `<Collapsible>` section in JjChangesView. The "History" section header becomes "Revision Graph" with the same collapse behavior.

**Performance:**
- Max 50 nodes rendered
- SVG is lightweight for this scale
- No virtualization needed at this node count

---

## 9. Router Composition

After all features, the changes router merges:

```typescript
// changes/index.ts
export function createChangesRouter() {
  return router({
    ...statusRouter._def.procedures,         // git status queries
    ...branchesRouter._def.procedures,        // branch operations
    ...gitOperationsRouter._def.procedures,   // git mutations
    ...stagingRouter._def.procedures,         // git staging
    ...jjQueryRouter._def.procedures,         // jjGetChangeStatus (read-only)
    ...jjMutationsRouter._def.procedures,     // jj edit/bookmark/squash/rebase
    ...jjConflictsRouter._def.procedures,     // jj conflict list/content/resolve
    ...jjDagRouter._def.procedures,           // jj DAG query
  });
}
```

---

## 10. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| jj conflict marker format changes | Unit tests with real jj output samples; parser is isolated |
| SVG DAG breaks on complex branching | Cap at 50 nodes; test with 3+ parallel branches |
| `@codemirror/merge` not in deps | Check before implementing; fallback to simple side-by-side |
| `jj edit` triggers file watcher storm | Debounce refetch by 200ms after edit mutation |
| Upstream sync conflicts | All new features in new files; existing file changes minimal (import path only) |
| Bookmark rename race condition | Atomic within `withJjRepoLock` — forget + create serialized |

---

## 11. Out of Scope

- Remote bookmark tracking (track/untrack)
- `jj split` UI
- `jj undo` / operation log UI
- Multi-workspace DAG view
- Full repo history DAG (beyond trunk..@ + bookmark heads)
