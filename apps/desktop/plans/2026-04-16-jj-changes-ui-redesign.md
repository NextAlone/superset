# jj Changes UI Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Replace the git-mapped Changes UI for jj repos with a native jj change-oriented view.

**Architecture:** jj repos get a dedicated `JjChangesView` component that renders alongside the existing `ChangesView` (which remains for git). The view is selected by `vcsType` from project data. Data comes from a new `jj.getChangeStatus` tRPC procedure that returns jj-native data structures.

**Tech Stack:** React, TanStack Router, tRPC, jj CLI

---

## Design: jj vs git mental model

| git concept | jj equivalent | UI mapping |
|-------------|---------------|------------|
| Staged files | ❌ doesn't exist | Hide entirely |
| Unstaged files | Working copy changes (`@` vs `@-`) | **"Current Change"** section |
| Untracked files | ❌ jj auto-tracks everything | Hide entirely |
| Commit | `jj commit` (snapshot + new empty `@`) | "Commit" button |
| — | `jj describe` (update `@` description) | "Describe" button |
| — | `jj squash` (fold `@` into parent) | "Squash" button |
| Branch | Bookmark | Rename all labels |
| Stash | ❌ not needed (working copy IS a commit) | Hide |
| Ahead/behind | Revset distance from trunk | Keep |

## UI Layout: JjChangesView

```
┌─────────────────────────────────────┐
│ ⟳ Refresh  📋 Base: main  🔀 Push  │  ← Header (simplified)
├─────────────────────────────────────┤
│ Current Change: trkkr               │  ← Change ID (short)
│ Description: [editable input]       │  ← jj describe
│                                     │
│ [Commit]  [Squash into parent]      │  ← Actions
├─────────────────────────────────────┤
│ ▼ Files Changed (3)                 │  ← Working copy diff (@  vs @-)
│   M  src/main.ts         +12 -3    │
│   A  src/new-file.ts     +45       │
│   D  src/old.ts          -20       │
│   [Discard] [Discard All]           │
├─────────────────────────────────────┤
│ ▼ Against Base: main (5 ahead)      │  ← Diff from base bookmark
│   M  src/main.ts         +52 -10   │
│   M  src/utils.ts        +8  -2    │
│   A  src/feature.ts      +120      │
│   ...                               │
├─────────────────────────────────────┤
│ ▼ Recent Changes (3)               │  ← Commit log (ancestors of @)
│   ○ abc123 feat: add X             │
│   ○ def456 fix: Y                  │
│   ○ ghi789 init                    │
└─────────────────────────────────────┘
```

### Key differences from git ChangesView:

1. **No staging section** — all working copy changes in one list
2. **Editable description** — inline text input for `jj describe`
3. **Change ID displayed** — shows short change_id, not branch name
4. **Squash button** — `jj squash` to fold into parent
5. **No stash** — not needed
6. **Bookmark selector** relabeled as "Base"

## Data Model

### New tRPC procedure: `jj.getChangeStatus`

```typescript
interface JjChangeStatus {
  // Current change metadata
  changeId: string;        // short change_id (e.g. "trkkr")
  commitId: string;        // full commit hash
  description: string;     // current description (may be empty)
  bookmark: string | null; // bookmark on @, if any
  author: string;
  timestamp: string;

  // Working copy changes (@ vs @-)
  files: ChangedFile[];    // modified/added/deleted files

  // Against base
  baseBookmark: string;
  againstBase: ChangedFile[];
  ahead: number;
  behind: number;

  // Recent ancestors (for commit log)
  ancestors: JjRevision[];

  // Repo state
  hasConflicts: boolean;
}

interface JjRevision {
  changeId: string;
  commitId: string;
  shortCommitId: string;
  description: string;
  author: string;
  timestamp: string;
  bookmarks: string[];
  isEmpty: boolean;
}
```

### jj CLI commands for data:

```bash
# Current change metadata
jj log -r @ --no-graph -T '<template>'

# Working copy changes (files)
jj diff --summary          # file list
jj diff --stat             # line counts
jj diff --git              # full diff (for file viewer)

# Against base
jj diff --summary --from <base> --to @
jj diff --stat --from <base> --to @

# Ancestor log
jj log -r '::@ ~ ::trunk()' --no-graph -T '<template>'

# Ahead/behind
jj log -r '::@ ~ ::<base>' --no-graph  # ahead count
jj log -r '::<base> ~ ::@' --no-graph  # behind count

# Description
jj describe -m "<text>"    # update description

# Commit
jj commit -m "<text>"      # snapshot + new @

# Squash
jj squash -m "<text>"      # fold @ into @-

# Discard file
jj restore <path>          # restore single file from @-

# Discard all
jj restore                 # restore all files from @-
```

## Implementation Tasks

### Task A: JjChangeStatus tRPC procedure

**Files:**
- Create: `src/lib/trpc/routers/changes/jj-change-status.ts`
- Modify: `src/lib/trpc/routers/changes/index.ts` — add jj router

New tRPC router with:
- `getChangeStatus` query — returns `JjChangeStatus`
- `describe` mutation — `jj describe -m "<text>"`
- `commit` mutation — `jj commit -m "<text>"`
- `squash` mutation — `jj squash -m "<text>"`
- `discardFile` mutation — `jj restore <path>`
- `discardAll` mutation — `jj restore`

### Task B: JjChangesView component

**Files:**
- Create: `src/renderer/screens/main/components/WorkspaceView/RightSidebar/JjChangesView/JjChangesView.tsx`
- Create: `src/renderer/screens/main/components/WorkspaceView/RightSidebar/JjChangesView/components/ChangeHeader.tsx`
- Create: `src/renderer/screens/main/components/WorkspaceView/RightSidebar/JjChangesView/components/DescriptionInput.tsx`
- Create: `src/renderer/screens/main/components/WorkspaceView/RightSidebar/JjChangesView/components/ChangeActions.tsx`
- Create: `src/renderer/screens/main/components/WorkspaceView/RightSidebar/JjChangesView/components/AncestorLog.tsx`

Reuse from existing ChangesView:
- `FileList` component — file list rendering (tree/flat mode)
- `CategorySection` — collapsible section wrapper
- File diff viewer — clicking a file opens diff
- `PRButton` — PR operations stay the same

### Task C: View routing by VCS type

**Files:**
- Modify: `src/renderer/screens/main/components/WorkspaceView/RightSidebar/RightSidebar.tsx` (or equivalent)

When workspace's `vcsType === "jj"`:
- Render `JjChangesView` instead of `ChangesView`
- Keep "Files" tab unchanged

### Task D: Wire up file diff viewer for jj

**Files:**
- Modify: `src/lib/trpc/routers/changes/file-contents.ts` (or create jj equivalent)

For jj repos, file diffs come from:
- `jj diff --git <path>` for working copy diff
- `jj diff --git --from <base> --to @ <path>` for against-base diff
- `jj show -r <rev> <path>` for historical revision diffs

### Task E: Remove git-mapped jj code

After JjChangesView is working, remove the interim git-mapped code:
- Remove jj routing from `staging.ts` (no longer needed)
- Remove jj routing from `git-operations.ts` commit/push/pull (moved to jj router)
- Remove `useOrderedSections` isJj logic
- Remove `ChangesHeader` isJj logic
- Keep `jj-status.ts` but refactor into `jj-change-status.ts`

## Migration path

1. Build Task A + B + C first (new jj-native view)
2. Test with jj repo — verify file list, describe, commit, squash work
3. Build Task D (file diff viewer)
4. Build Task E (cleanup old code)
5. Final testing
