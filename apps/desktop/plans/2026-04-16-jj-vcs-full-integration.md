# Jujutsu (jj) Full VCS Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Jujutsu (jj) support to Superset desktop — workspace lifecycle AND Changes UI (status, commit, push, pull, diff) all go through jj when a repo has `.jj`.

**Architecture:** VcsProvider interface abstracts all VCS operations. GitProvider wraps existing simple-git code (zero behavior change). JjProvider uses jj CLI. Factory detects `.jj` directory, caches provider per repo. Callers get provider via factory. jj has no staging area — the Changes UI adapts: staged section hidden, all working copy changes shown as "unstaged", commit operates on all changes.

**Tech Stack:** TypeScript, jj CLI, simple-git (existing), tRPC, Drizzle ORM, SQLite

**Key jj concepts for implementers:**
- Working copy IS always a commit — no staging area
- `jj status` → shows modified/added/deleted files
- `jj diff --summary` → concise file status (M/A/D/R)
- `jj diff --stat` → additions/deletions counts
- `jj diff --git` → unified diff in git format
- `jj commit -m "msg"` → snapshot working copy, create new empty working copy
- `jj describe -m "msg"` → update current commit's description (doesn't create new)
- `jj git push -b <bookmark>` → push bookmark to remote
- `jj git fetch` → fetch from remote
- `jj bookmark list` → list bookmarks (≈ git branches)
- `jj new` → create new empty change on top of current

---

## File Structure

### New files to create:
| File | Responsibility |
|------|---------------|
| `src/lib/trpc/routers/workspaces/utils/vcs/types.ts` | VcsProvider interface + VcsType |
| `src/lib/trpc/routers/workspaces/utils/vcs/git-provider.ts` | GitProvider — delegates to existing git.ts |
| `src/lib/trpc/routers/workspaces/utils/vcs/jj-provider.ts` | JjProvider — full jj CLI implementation |
| `src/lib/trpc/routers/workspaces/utils/vcs/index.ts` | Factory: detectVcsType(), getVcsProvider(), re-exports |
| `src/lib/trpc/routers/changes/jj-commands.ts` | jj equivalents of git-commands.ts (staging/discard ops) |
| `src/lib/trpc/routers/changes/jj-status.ts` | Parse jj status/diff into GitChangesStatus format |
| `packages/local-db/drizzle/0040_add_vcs_type_to_projects.sql` | DB migration |

### Files to modify:
| File | Change |
|------|--------|
| `packages/local-db/src/schema/schema.ts` | Add `vcsType` column to projects |
| `packages/local-db/src/schema/zod.ts` | Add VcsType zod type |
| `src/lib/trpc/routers/workspaces/utils/workspace-init.ts` | Use VcsProvider for worktree creation |
| `src/lib/trpc/routers/workspaces/procedures/create.ts` | Use VcsProvider for workspace creation |
| `src/lib/trpc/routers/workspaces/procedures/delete.ts` | Use VcsProvider for safety checks & removal |
| `src/lib/trpc/routers/workspaces/procedures/git-status.ts` | Use VcsProvider for status refresh |
| `src/lib/trpc/routers/workspaces/utils/teardown.ts` | Use VcsProvider for worktree removal |
| `src/lib/trpc/routers/projects/projects.ts` | Detect VCS type, store in DB |
| `src/lib/trpc/routers/changes/branches.ts` | Use VcsProvider for branch/bookmark listing |
| `src/lib/trpc/routers/changes/staging.ts` | Route to jj-commands.ts for jj repos |
| `src/lib/trpc/routers/changes/git-operations.ts` | Route commit/push/pull/sync to jj for jj repos |
| `src/lib/trpc/routers/changes/status.ts` | Use jj status for jj repos |
| `src/lib/trpc/routers/changes/workers/git-task-handlers.ts` | Support jj status computation |

---

## Task 1: VcsProvider Interface & Types

**Files:**
- Create: `src/lib/trpc/routers/workspaces/utils/vcs/types.ts`
- Modify: `packages/local-db/src/schema/schema.ts`
- Modify: `packages/local-db/src/schema/zod.ts`
- Create: `packages/local-db/drizzle/0040_add_vcs_type_to_projects.sql`

### Interface design

The VcsProvider covers two domains:
1. **Workspace lifecycle** — create/delete/list workspaces, branch ops
2. **Changes UI** — status, commit, push, pull, diff, staging (no-op for jj)

- [ ] **Step 1: Create VcsProvider interface**

```typescript
// src/lib/trpc/routers/workspaces/utils/vcs/types.ts

export type VcsType = "git" | "jj";

export interface ExternalWorkspace {
  path: string;
  branch: string | null;
  isDetached: boolean;
  isBare: boolean;
}

export interface BranchExistsOnRemoteResult {
  status: "exists" | "not_found" | "error";
  message?: string;
}

export interface VcsChangesStatus {
  branch: string | null;
  staged: VcsChangedFile[];
  unstaged: VcsChangedFile[];
  untracked: VcsChangedFile[];
  ahead: number;
  behind: number;
}

export interface VcsChangedFile {
  path: string;
  oldPath?: string;
  status: "added" | "deleted" | "renamed" | "copied" | "untracked" | "modified";
}

export interface VcsProvider {
  readonly type: VcsType;

  // --- Workspace lifecycle ---
  createWorkspace(params: {
    mainRepoPath: string;
    branch: string;
    workspacePath: string;
    startPoint?: string;
  }): Promise<void>;

  createWorkspaceFromExistingBranch(params: {
    mainRepoPath: string;
    branch: string;
    workspacePath: string;
  }): Promise<void>;

  removeWorkspace(mainRepoPath: string, workspacePath: string): Promise<void>;

  workspaceExists(mainRepoPath: string, workspacePath: string): Promise<boolean>;

  listExternalWorkspaces(mainRepoPath: string): Promise<ExternalWorkspace[]>;

  getBranchWorkspacePath(params: {
    mainRepoPath: string;
    branch: string;
  }): Promise<string | null>;

  // --- Branch/bookmark operations ---
  getCurrentBranch(repoPath: string): Promise<string | null>;

  listBranches(
    repoPath: string,
    options?: { fetch?: boolean },
  ): Promise<{ local: string[]; remote: string[] }>;

  getDefaultBranch(mainRepoPath: string): Promise<string>;

  refreshDefaultBranch(mainRepoPath: string): Promise<string | null>;

  fetchDefaultBranch(mainRepoPath: string, defaultBranch: string): Promise<string>;

  deleteLocalBranch(params: { mainRepoPath: string; branch: string }): Promise<void>;

  checkoutBranch(repoPath: string, branch: string): Promise<void>;

  safeCheckoutBranch(repoPath: string, branch: string): Promise<void>;

  // --- Ref/remote checks ---
  refExistsLocally(repoPath: string, ref: string): Promise<boolean>;

  hasOriginRemote(mainRepoPath: string): Promise<boolean>;

  branchExistsOnRemote(
    repoPath: string,
    branch: string,
  ): Promise<BranchExistsOnRemoteResult>;

  getRepoRoot(path: string): Promise<string>;

  // --- Base branch config ---
  getBaseBranchConfig(repoPath: string, branch: string): Promise<string | null>;
  setBaseBranchConfig(repoPath: string, branch: string, baseBranch: string): Promise<void>;

  // --- Status & changes ---
  getAheadBehindCount(params: {
    repoPath: string;
    defaultBranch: string;
  }): Promise<{ ahead: number; behind: number }>;

  hasUncommittedChanges(workspacePath: string): Promise<boolean>;

  hasUnpushedCommits(workspacePath: string): Promise<boolean>;

  // --- Changes UI operations ---
  getStatus(repoPath: string, defaultBranch?: string): Promise<VcsChangesStatus>;

  commit(repoPath: string, message: string): Promise<{ hash: string }>;

  push(repoPath: string, options?: { setUpstream?: boolean }): Promise<void>;

  pull(repoPath: string): Promise<void>;

  fetch(repoPath: string): Promise<void>;

  getDiff(repoPath: string, filePath?: string): Promise<string>;

  // --- Staging (git-only, no-op for jj) ---
  readonly supportsStaging: boolean;

  stageFile(repoPath: string, filePath: string): Promise<void>;
  unstageFile(repoPath: string, filePath: string): Promise<void>;
  stageAll(repoPath: string): Promise<void>;
  unstageAll(repoPath: string): Promise<void>;
  discardFile(repoPath: string, filePath: string): Promise<void>;
  discardAllUnstaged(repoPath: string): Promise<void>;
  stash(repoPath: string): Promise<void>;
  stashPop(repoPath: string): Promise<void>;
}
```

- [ ] **Step 2: Add vcsType to DB schema**

In `packages/local-db/src/schema/schema.ts`, add to projects table:

```typescript
vcsType: text("vcs_type"),  // "git" | "jj" | null (null = git default)
```

In `packages/local-db/src/schema/zod.ts`, add:

```typescript
export const VcsType = z.enum(["git", "jj"]);
```

- [ ] **Step 3: Create DB migration**

```sql
-- packages/local-db/drizzle/0040_add_vcs_type_to_projects.sql
ALTER TABLE `projects` ADD `vcs_type` text;
```

Update `packages/local-db/drizzle/meta/_journal.json` — add entry with idx 40.
Generate snapshot via `bunx drizzle-kit generate --name="0040_add_vcs_type_to_projects"` or manually create the snapshot JSON.

- [ ] **Step 4: Commit**

```
feat(local-db): add vcs_type column to projects + VcsProvider interface
```

---

## Task 2: GitProvider — Wrap Existing Code

**Files:**
- Create: `src/lib/trpc/routers/workspaces/utils/vcs/git-provider.ts`

Zero behavior changes. Thin delegation to existing functions in `git.ts`.

- [ ] **Step 1: Create GitProvider**

```typescript
// src/lib/trpc/routers/workspaces/utils/vcs/git-provider.ts

import type { VcsProvider, ExternalWorkspace, BranchExistsOnRemoteResult, VcsChangesStatus, VcsChangedFile } from "./types";
import {
  createWorktree,
  createWorktreeFromExistingBranch,
  removeWorktree,
  getCurrentBranch,
  listBranches,
  getDefaultBranch,
  refreshDefaultBranch,
  deleteLocalBranch,
  checkoutBranch,
  safeCheckoutBranch,
  hasUncommittedChanges,
  hasUnpushedCommits,
  getAheadBehindCount,
  branchExistsOnRemote,
  hasOriginRemote,
  refExistsLocally,
  listExternalWorktrees,
  getStatusNoLock,
  // ... other imports from git.ts
} from "../git";
import { getSimpleGitWithShellPath } from "../../changes/git-client";
import { getBranchBaseConfig, setBranchBaseConfig } from "../../changes/utils/base-branch-config";

export class GitProvider implements VcsProvider {
  readonly type = "git" as const;
  readonly supportsStaging = true;

  // Each method delegates to the corresponding git.ts function.
  // Example:
  async createWorkspace(params) {
    await createWorktree(params.mainRepoPath, params.branch, params.workspacePath, params.startPoint);
  }
  // ... (all methods follow same pattern — delegate to existing git.ts functions)
}
```

This file wraps every method from `git.ts` that matches the VcsProvider interface. Import the security-wrapped versions from `git-commands.ts` for staging operations.

- [ ] **Step 2: Verify git.ts exports**

Check that all needed functions are exported from `git.ts`. If any are missing, add exports without changing behavior.

- [ ] **Step 3: Commit**

```
feat(desktop): add GitProvider wrapping existing git.ts
```

---

## Task 3: JjProvider — Full Implementation

**Files:**
- Create: `src/lib/trpc/routers/workspaces/utils/vcs/jj-provider.ts`

- [ ] **Step 1: Create jj CLI helper**

```typescript
// Top of jj-provider.ts

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { getShellEnvironment } from "../shell-env";
import type { VcsProvider, ExternalWorkspace, BranchExistsOnRemoteResult, VcsChangesStatus, VcsChangedFile } from "./types";

const execFileAsync = promisify(execFile);

// Per-repo mutex to serialize jj operations (jj uses internal store locks)
const repoLocks = new Map<string, Promise<unknown>>();

function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(repoPath);
  const prev = repoLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  repoLocks.set(key, next);
  next.finally(() => { if (repoLocks.get(key) === next) repoLocks.delete(key); });
  return next;
}

async function getJjEnv(): Promise<Record<string, string>> {
  const shellEnv = await getShellEnvironment();
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") result[key] = value;
  }
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  if (shellEnv[pathKey]) result[pathKey] = shellEnv[pathKey];
  return result;
}

async function jj(
  repoPath: string,
  args: string[],
  timeout = 30_000,
  lockKey?: string,
): Promise<string> {
  return withRepoLock(lockKey ?? repoPath, async () => {
    const env = await getJjEnv();
    const { stdout } = await execFileAsync(
      "jj",
      ["--no-pager", "--color=never", "-R", repoPath, ...args],
      { env, timeout },
    );
    return stdout;
  });
}

function gitRefToJjRevset(ref: string): string {
  if (ref.startsWith("refs/remotes/origin/")) return `${ref.slice("refs/remotes/origin/".length)}@origin`;
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  if (ref.startsWith("origin/")) return `${ref.slice("origin/".length)}@origin`;
  return ref;
}
```

- [ ] **Step 2: Implement workspace lifecycle methods**

These follow the original PR's design — `jj workspace add/forget/list`, bookmark management.

Key methods:
- `createWorkspace()` → `jj workspace add <path> --name <name>` + `jj bookmark create`
- `removeWorkspace()` → `jj workspace forget` + rename + background rm
- `workspaceExists()` → check disk + `jj workspace list`
- `listExternalWorkspaces()` → `git worktree list --porcelain` (colocated)
- `getCurrentBranch()` → `jj log -r @ --no-graph -T bookmarks`
- `listBranches()` → `jj bookmark list --all-remotes`
- `getDefaultBranch()` → `jj config get revset-aliases."trunk()"` with fallback

- [ ] **Step 3: Implement Changes UI methods**

```typescript
// Status — parse jj diff --summary + jj diff --stat
async getStatus(repoPath: string, defaultBranch?: string): Promise<VcsChangesStatus> {
  // 1. Get file changes via: jj diff --summary
  //    Output: "M path", "A path", "D path", "R old new"
  // 2. Get line counts via: jj diff --stat
  //    Output: "path | N +++ ---"
  // 3. Get current branch via getCurrentBranch()
  // 4. Get ahead/behind via getAheadBehindCount()
  // 5. Map to VcsChangesStatus — all files go to "unstaged" (no staging in jj)
}

// Commit — jj commit -m "message"
async commit(repoPath: string, message: string): Promise<{ hash: string }> {
  // jj commit -m "message"
  // Parse output for commit hash: "Working copy now at: <change_id> <commit_id>"
  // Return the parent commit hash (the one just committed)
  const output = await jj(repoPath, ["commit", "-m", message]);
  // Extract commit_id from: "Parent commit      : <short_change_id> <commit_id>"
  // Or use: jj log -r @- --no-graph -T commit_id
  const hashOutput = await jj(repoPath, ["log", "-r", "@-", "--no-graph", "-T", "commit_id"]);
  return { hash: hashOutput.trim() };
}

// Push — jj git push
async push(repoPath: string): Promise<void> {
  // Find bookmark on current commit
  const branch = await this.getCurrentBranch(repoPath);
  if (!branch) throw new Error("No bookmark on current commit");
  await jj(repoPath, ["git", "push", "-b", branch], 60_000);
}

// Pull — jj git fetch + rebase
async pull(repoPath: string): Promise<void> {
  await jj(repoPath, ["git", "fetch"], 60_000);
  // Auto-rebase working copy onto updated trunk
  // jj rebase -d <default_branch>@origin (if applicable)
}

// Fetch
async fetch(repoPath: string): Promise<void> {
  await jj(repoPath, ["git", "fetch"], 60_000);
}

// Diff
async getDiff(repoPath: string, filePath?: string): Promise<string> {
  const args = ["diff", "--git"];
  if (filePath) args.push(filePath);
  return jj(repoPath, args);
}

// Staging — no-op for jj
readonly supportsStaging = false;
async stageFile() {}
async unstageFile() {}
async stageAll() {}
async unstageAll() {}

// Discard — jj restore
async discardFile(repoPath: string, filePath: string): Promise<void> {
  await jj(repoPath, ["restore", "--from", "@-", filePath]);
}
async discardAllUnstaged(repoPath: string): Promise<void> {
  await jj(repoPath, ["restore"]);
}

// Stash — not needed in jj (working copy is always a commit)
async stash() {}
async stashPop() {}
```

- [ ] **Step 4: Commit**

```
feat(desktop): add JjProvider with full jj CLI integration
```

---

## Task 4: VCS Factory & Detection

**Files:**
- Create: `src/lib/trpc/routers/workspaces/utils/vcs/index.ts`

- [ ] **Step 1: Create factory**

```typescript
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { GitProvider } from "./git-provider";
import { JjProvider } from "./jj-provider";
import type { VcsProvider, VcsType } from "./types";

export type { VcsProvider, VcsType, ExternalWorkspace, BranchExistsOnRemoteResult } from "./types";

const providerCache = new Map<string, VcsProvider>();
let jjAvailabilityResult: boolean | null = null;

export function detectVcsType(mainRepoPath: string): VcsType {
  if (existsSync(join(mainRepoPath, ".jj"))) return "jj";
  return "git";
}

function isJjCliAvailable(): boolean {
  if (jjAvailabilityResult !== null) return jjAvailabilityResult;
  try {
    execFileSync("jj", ["version"], { timeout: 5_000, stdio: "ignore" });
    jjAvailabilityResult = true;
  } catch {
    jjAvailabilityResult = false;
  }
  return jjAvailabilityResult;
}

export function getVcsProvider(mainRepoPath: string): VcsProvider {
  const cached = providerCache.get(mainRepoPath);
  if (cached) return cached;

  const vcsType = detectVcsType(mainRepoPath);
  let provider: VcsProvider;

  if (vcsType === "jj" && isJjCliAvailable()) {
    console.log(`[vcs] Detected jj repo at ${mainRepoPath}, using JjProvider`);
    provider = new JjProvider();
  } else {
    if (vcsType === "jj") {
      console.warn(`[vcs] jj repo detected but CLI not found — falling back to GitProvider`);
    }
    provider = new GitProvider();
  }

  providerCache.set(mainRepoPath, provider);
  return provider;
}

export function clearVcsProviderCache(mainRepoPath?: string): void {
  if (mainRepoPath) providerCache.delete(mainRepoPath);
  else providerCache.clear();
}

// Re-export git-specific utilities NOT in VcsProvider (PR handling, branch naming, etc.)
export {
  generateBranchName,
  getAuthorPrefix,
  getBranchPrefix,
  getGitHubUsername,
  getPrInfo,
  parsePrUrl,
  sanitizeBranchName,
  sanitizeGitError,
  // ... other git-only exports
} from "../git";
```

- [ ] **Step 2: Commit**

```
feat(desktop): add VCS factory with auto-detection
```

---

## Task 5: Migrate Workspace Lifecycle Callers

**Files:**
- Modify: `src/lib/trpc/routers/workspaces/utils/workspace-init.ts`
- Modify: `src/lib/trpc/routers/workspaces/procedures/create.ts`
- Modify: `src/lib/trpc/routers/workspaces/procedures/delete.ts`
- Modify: `src/lib/trpc/routers/workspaces/procedures/git-status.ts`
- Modify: `src/lib/trpc/routers/workspaces/utils/teardown.ts`
- Modify: `src/lib/trpc/routers/projects/projects.ts`

For each file:
1. Replace direct `git.ts` imports with `getVcsProvider(mainRepoPath)` calls
2. Call provider methods instead of git.ts functions
3. Keep git-only utilities (PR handling, branch naming) as direct imports

- [ ] **Step 1: Migrate workspace-init.ts**

Replace:
```typescript
import { createWorktree, createWorktreeFromExistingBranch, ... } from "../utils/git";
```
With:
```typescript
import { getVcsProvider } from "../utils/vcs";
```

Then change calls like:
```typescript
// Before:
await createWorktree(mainRepoPath, branch, worktreePath, startPoint);
// After:
const vcs = getVcsProvider(mainRepoPath);
await vcs.createWorkspace({ mainRepoPath, branch, workspacePath: worktreePath, startPoint });
```

Apply same pattern to: `refreshDefaultBranch`, `branchExistsOnRemote`, `refExistsLocally`, `getDefaultBranch`, `fetchDefaultBranch`, `hasOriginRemote`.

- [ ] **Step 2: Migrate create.ts**

Replace git.ts imports for: `listExternalWorktrees` → `vcs.listExternalWorkspaces()`, `getBranchWorkspacePath` → `vcs.getBranchWorkspacePath()`.

- [ ] **Step 3: Migrate delete.ts**

Replace: `hasUncommittedChanges`, `hasUnpushedCommits`, `removeWorktree` → provider methods.

- [ ] **Step 4: Migrate git-status.ts**

Replace: `getAheadBehindCount`, `getCurrentBranch`, `checkNeedsRebase` → provider methods.

- [ ] **Step 5: Migrate teardown.ts**

Replace: `removeWorktree` → `vcs.removeWorkspace()`.

- [ ] **Step 6: Migrate projects.ts**

Add VCS type detection on project open:
```typescript
import { detectVcsType } from "../workspaces/utils/vcs";

// In project creation/open:
const vcsType = detectVcsType(mainRepoPath);
// Store in DB:
await db.update(projects).set({ vcsType }).where(eq(projects.id, projectId));
```

Also migrate `getDefaultBranch`, `hasOriginRemote` to use provider.

- [ ] **Step 7: Commit**

```
refactor(desktop): migrate workspace lifecycle to VcsProvider
```

---

## Task 6: Migrate Changes UI — Status

**Files:**
- Modify: `src/lib/trpc/routers/changes/status.ts`
- Modify: `src/lib/trpc/routers/changes/workers/git-task-handlers.ts`
- Create: `src/lib/trpc/routers/changes/jj-status.ts`

- [ ] **Step 1: Create jj status parser**

```typescript
// src/lib/trpc/routers/changes/jj-status.ts

import type { ChangedFile, GitChangesStatus } from "shared/changes-types";

/**
 * Parse `jj diff --summary` output into ChangedFile array.
 * Format: "M path", "A path", "D path", "R old new"
 */
export function parseJjDiffSummary(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const status = trimmed[0];
    const rest = trimmed.slice(2).trim();
    switch (status) {
      case "M": files.push({ path: rest, status: "modified", additions: 0, deletions: 0 }); break;
      case "A": files.push({ path: rest, status: "added", additions: 0, deletions: 0 }); break;
      case "D": files.push({ path: rest, status: "deleted", additions: 0, deletions: 0 }); break;
      case "R": {
        const parts = rest.split(" ");
        // "R {from} {to}" — jj uses "{from} → {to}" or space-separated
        files.push({ path: parts[parts.length - 1], oldPath: parts[0], status: "renamed", additions: 0, deletions: 0 });
        break;
      }
    }
  }
  return files;
}

/**
 * Parse `jj diff --stat` output to get additions/deletions.
 * Format: "path | N +++ ---"
 */
export function applyJjDiffStat(files: ChangedFile[], statOutput: string): void {
  // Parse each line, match path, extract additions/deletions count
  for (const line of statOutput.split("\n")) {
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s/);
    if (!match) continue;
    const [, path, _total] = match;
    const plusCount = (line.match(/\+/g) || []).length;
    const minusCount = (line.match(/-/g) || []).length;
    const file = files.find(f => f.path === path.trim());
    if (file) {
      file.additions = plusCount;
      file.deletions = minusCount;
    }
  }
}
```

- [ ] **Step 2: Route status queries to jj for jj repos**

In `status.ts` / `git-task-handlers.ts`, detect VCS type and branch:
- For git repos: use existing `computeStatus()` unchanged
- For jj repos: call `jj diff --summary` + `jj diff --stat` + parse

The worker pool can be extended with a `"getJjStatus"` task type, or the jj status can be computed inline (jj CLI is fast enough for inline use since it doesn't need a worker pool like git).

- [ ] **Step 3: Commit**

```
feat(desktop): add jj status parsing for Changes UI
```

---

## Task 7: Migrate Changes UI — Staging & Operations

**Files:**
- Create: `src/lib/trpc/routers/changes/jj-commands.ts`
- Modify: `src/lib/trpc/routers/changes/staging.ts`
- Modify: `src/lib/trpc/routers/changes/git-operations.ts`

- [ ] **Step 1: Create jj-commands.ts**

```typescript
// Equivalents of git-commands.ts for jj repos

export async function jjDiscardFile(repoPath: string, filePath: string): Promise<void> {
  // jj restore --from @- <filePath>
}

export async function jjDiscardAll(repoPath: string): Promise<void> {
  // jj restore
}

// Stage/unstage are no-ops for jj
export async function jjStageFile(_repoPath: string, _filePath: string): Promise<void> {}
export async function jjUnstageFile(_repoPath: string, _filePath: string): Promise<void> {}
export async function jjStageAll(_repoPath: string): Promise<void> {}
export async function jjUnstageAll(_repoPath: string): Promise<void> {}
```

- [ ] **Step 2: Route staging.ts to jj-commands for jj repos**

In each mutation, detect VCS type from the worktree path:
```typescript
// Resolve project from worktree path to get VCS type
// If jj: delegate to jj-commands.ts
// If git: delegate to git-commands.ts (existing behavior)
```

Key: for jj repos, `stageFile`/`unstageFile` are no-ops but should return success. `discardChanges` maps to `jj restore`.

- [ ] **Step 3: Route git-operations.ts to VcsProvider**

```typescript
// commit mutation:
// git: git.commit(message) — existing
// jj: jj commit -m "message" — via provider

// push mutation:
// git: git push — existing
// jj: jj git push -b <bookmark> — via provider

// pull mutation:
// git: git pull --rebase — existing
// jj: jj git fetch — via provider

// sync mutation:
// git: pull + push — existing
// jj: jj git fetch + jj git push — via provider

// PR operations (createPR, mergePR):
// Keep using gh CLI for both — GitHub API is VCS-agnostic
// Just need to ensure branch name resolution works for jj bookmarks
```

- [ ] **Step 4: Commit**

```
feat(desktop): route Changes UI operations through VcsProvider
```

---

## Task 8: Migrate Branch Management

**Files:**
- Modify: `src/lib/trpc/routers/changes/branches.ts`

- [ ] **Step 1: Route branch queries to VcsProvider**

The `getBranches` query currently uses `git for-each-ref`, `git symbolic-ref`, `git worktree list`. For jj:
- Local branches → `jj bookmark list`
- Remote branches → `jj bookmark list --all-remotes`
- Default branch → `jj config get revset-aliases."trunk()"`
- Checked-out branches → `jj workspace list`
- Current branch → `jj log -r @ --no-graph -T bookmarks`

- [ ] **Step 2: Route switchBranch to VcsProvider**

```typescript
// git: gitSwitchBranch()
// jj: jj edit <bookmark>
```

- [ ] **Step 3: Route updateBaseBranch to VcsProvider**

```typescript
// git: setBranchBaseConfig() via git config
// jj: same (colocated mode uses .git config) OR jj config set
```

- [ ] **Step 4: Commit**

```
feat(desktop): route branch management through VcsProvider
```

---

## Task 9: UI Adaptation — Hide Staging for jj

**Files:**
- Modify: `src/renderer/screens/main/components/WorkspaceView/RightSidebar/ChangesView/ChangesView.tsx`
- Modify: relevant UI components that show staged/unstaged sections

- [ ] **Step 1: Pass VCS type to renderer**

Add `vcsType` to workspace query response. The renderer can check `vcsType === "jj"` to hide staging controls.

- [ ] **Step 2: Adapt ChangesView**

For jj repos:
- Hide "Staged" section entirely
- Show all files under a single "Changes" section (no staged/unstaged split)
- Hide stage/unstage buttons
- Commit button commits all working copy changes (no "stage then commit" flow)
- Hide stash buttons

- [ ] **Step 3: Commit**

```
feat(desktop): adapt Changes UI for jj (hide staging controls)
```

---

## Task 10: Integration Testing

- [ ] **Step 1: Test with git-only repo**

Open a git-only repo → verify all existing functionality works identically.

- [ ] **Step 2: Test with jj colocated repo**

```bash
mkdir /tmp/test-jj && cd /tmp/test-jj
jj git init --colocate
echo "hello" > README.md
jj commit -m "init"
```

Open in Superset → verify:
- `vcsType` set to `"jj"` in DB
- Workspace creation uses `jj workspace add`
- Changes UI shows working copy changes (no staging)
- Commit works via `jj commit`
- Bookmark listing works

- [ ] **Step 3: Test workspace lifecycle**

- Create workspace → `jj workspace list` shows it
- Delete workspace → `jj workspace forget` called
- Ahead/behind counts work

- [ ] **Step 4: Test edge cases**

- Machine without jj installed → falls back to GitProvider
- jj repo with no remote → local-only operations work
- Workspace with uncommitted changes → delete warning works

- [ ] **Step 5: Commit final**

```
test(desktop): verify jj VCS integration end-to-end
```
