import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { execWithShellEnv } from "../shell-env";
import { jj } from "../../../changes/utils/jj-cli";
import type {
  BranchExistsOnRemoteResult,
  ExternalWorkspace,
  VcsProvider,
  VcsType,
} from "./types";

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execWithShellEnv("git", args, { cwd: repoPath });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Ref conversion helpers
// ---------------------------------------------------------------------------

// Known remote names — used to guard against misidentifying branch paths
const KNOWN_REMOTES = new Set(["origin", "upstream", "fork"]);

/**
 * Convert git-style refs/branch names to jj revset syntax.
 *   origin/main              → main@origin
 *   refs/heads/main          → main
 *   refs/remotes/origin/main → main@origin
 *   main                     → main (passthrough)
 *   feature/foo              → feature/foo (not converted — no known remote prefix)
 */
function gitRefToJjRevset(ref: string): string {
  if (ref.startsWith("refs/remotes/")) {
    // refs/remotes/origin/main → main@origin
    const parts = ref.slice("refs/remotes/".length).split("/");
    const remote = parts[0];
    const branch = parts.slice(1).join("/");
    return `${branch}@${remote}`;
  }
  if (ref.startsWith("refs/heads/")) {
    return ref.slice("refs/heads/".length);
  }
  // origin/main → main@origin (only when first segment is a known remote)
  const slashIdx = ref.indexOf("/");
  if (slashIdx !== -1) {
    const maybeRemote = ref.slice(0, slashIdx);
    const branch = ref.slice(slashIdx + 1);
    if (KNOWN_REMOTES.has(maybeRemote) && !branch.includes("@")) {
      return `${branch}@${maybeRemote}`;
    }
  }
  return ref;
}

// ---------------------------------------------------------------------------
// Parse git worktree list --porcelain output
// ---------------------------------------------------------------------------

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isDetached: boolean;
  isBare: boolean;
}

function parseWorktreePorcelain(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current?.path) {
        entries.push({
          path: current.path,
          branch: current.branch ?? null,
          isDetached: current.isDetached ?? false,
          isBare: current.isBare ?? false,
        });
      }
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ") && current) {
      const branchRef = line.slice("branch ".length).trim();
      // refs/heads/main → main
      current.branch = branchRef.startsWith("refs/heads/")
        ? branchRef.slice("refs/heads/".length)
        : branchRef;
    } else if (line === "detached" && current) {
      current.isDetached = true;
    } else if (line === "bare" && current) {
      current.isBare = true;
    }
  }

  if (current?.path) {
    entries.push({
      path: current.path,
      branch: current.branch ?? null,
      isDetached: current.isDetached ?? false,
      isBare: current.isBare ?? false,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// JjProvider
// ---------------------------------------------------------------------------

export class JjProvider implements VcsProvider {
  readonly type: VcsType = "jj";
  readonly supportsStaging = false;

  // -------------------------------------------------------------------------
  // Workspace lifecycle
  // -------------------------------------------------------------------------

  async createWorkspace(params: {
    mainRepoPath: string;
    branch: string;
    workspacePath: string;
    startPoint?: string;
  }): Promise<void> {
    const { mainRepoPath, branch, workspacePath, startPoint } = params;
    const name = basename(workspacePath);

    await mkdir(workspacePath, { recursive: true });

    const addArgs = ["workspace", "add", workspacePath, "--name", name];
    if (startPoint) {
      addArgs.push("-r", gitRefToJjRevset(startPoint));
    }
    await jj(mainRepoPath, addArgs);

    // Create bookmark pointing to the workspace's @ revision
    await jj(workspacePath, ["bookmark", "create", branch, "-r", "@"]);
  }

  async createWorkspaceFromExistingBranch(params: {
    mainRepoPath: string;
    branch: string;
    workspacePath: string;
  }): Promise<void> {
    const { mainRepoPath, branch, workspacePath } = params;
    const name = basename(workspacePath);

    await mkdir(workspacePath, { recursive: true });

    // Checkout at the existing branch bookmark
    await jj(mainRepoPath, [
      "workspace",
      "add",
      workspacePath,
      "--name",
      name,
      "-r",
      branch,
    ]);
  }

  async removeWorkspace(
    mainRepoPath: string,
    workspacePath: string,
  ): Promise<void> {
    const name = basename(workspacePath);

    // Forget workspace from jj's tracking
    try {
      await jj(mainRepoPath, ["workspace", "forget", name]);
    } catch {
      // Best-effort — workspace may already be forgotten
    }

    if (existsSync(workspacePath)) {
      // Use system temp dir to avoid jj snapshotting the partially deleted tree
      const tmpPath = join(tmpdir(), `.superset-removed-ws-${randomUUID()}`);
      try {
        await rename(workspacePath, tmpPath);
        // Fire-and-forget background deletion
        const child = spawn("rm", ["-rf", tmpPath], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      } catch {
        // Directory may have already been cleaned up
      }
    }
  }

  async workspaceExists(
    mainRepoPath: string,
    workspacePath: string,
  ): Promise<boolean> {
    if (!existsSync(workspacePath)) {
      return false;
    }
    try {
      const output = await jj(mainRepoPath, ["workspace", "list"]);
      const name = basename(workspacePath);
      return output.includes(name);
    } catch {
      return false;
    }
  }

  async listExternalWorkspaces(
    mainRepoPath: string,
  ): Promise<ExternalWorkspace[]> {
    try {
      const output = await jj(mainRepoPath, ["workspace", "list"]);
      // Each line: "<name>: <change_id> <commit_id> <description>"
      const lines = output.split("\n").filter((l) => l.trim());
      const entries: ExternalWorkspace[] = [];

      for (const line of lines) {
        const colonIdx = line.indexOf(":");
        if (colonIdx < 0) continue;
        const name = line.slice(0, colonIdx).trim();
        if (name === "default") continue; // skip main workspace

        try {
          const wsPath = await jj(mainRepoPath, [
            "workspace",
            "root",
            "--name",
            name,
          ]);
          entries.push({
            path: wsPath.trim(),
            branch: name, // workspace name as "branch"
            isDetached: false,
            isBare: false,
          });
        } catch {
          // workspace may be stale
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  async getBranchWorkspacePath(params: {
    mainRepoPath: string;
    branch: string;
  }): Promise<string | null> {
    const { mainRepoPath, branch } = params;
    try {
      // In jj, "branch" here is actually the workspace name
      const wsPath = await jj(mainRepoPath, [
        "workspace",
        "root",
        "--name",
        branch,
      ]);
      return wsPath.trim() || null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Branch / bookmark operations
  // -------------------------------------------------------------------------

  async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const output = await jj(repoPath, [
        "log",
        "-r",
        "@",
        "--no-graph",
        "-T",
        "bookmarks",
      ]);
      if (output) {
        // First word, strip trailing '*'
        const first = output.split(/\s/)[0];
        if (first) return first.replace(/\*$/, "");
      }
      // jj working copy often has no bookmark — use short change_id as fallback
      const changeId = await jj(repoPath, [
        "log",
        "-r",
        "@",
        "--no-graph",
        "-T",
        "change_id.shortest()",
      ]);
      return changeId.trim() || null;
    } catch {
      return null;
    }
  }

  async listBranches(
    repoPath: string,
    options?: { fetch?: boolean },
  ): Promise<{ local: string[]; remote: string[] }> {
    if (options?.fetch) {
      try {
        await jj(repoPath, ["git", "fetch"]);
      } catch {
        // Non-fatal
      }
    }

    try {
      const output = await jj(repoPath, [
        "bookmark",
        "list",
        "--all-remotes",
      ]);
      const local = new Set<string>();
      const remote = new Set<string>();

      for (const line of output.split("\n")) {
        if (!line || line.startsWith(" ")) continue; // skip empty + indented tracking lines (@git, @origin)
        const trimmed = line.trim();
        if (!trimmed) continue;
        // "name: ..." — local bookmark
        // "name@origin: ..." — remote bookmark
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        if (key.includes("@")) {
          // remote: strip @remote suffix
          const name = key.slice(0, key.indexOf("@"));
          if (name) remote.add(name);
        } else {
          local.add(key);
        }
      }

      return { local: [...local], remote: [...remote] };
    } catch {
      return { local: [], remote: [] };
    }
  }

  async getDefaultBranch(mainRepoPath: string): Promise<string> {
    try {
      const output = await jj(mainRepoPath, [
        "config",
        "get",
        'revset-aliases."trunk()"',
      ]);
      // Could be:
      //   "main@origin"
      //   "main"
      //   'latest(remote_bookmarks(exact:"main", exact:"origin"))'
      // Extract the bookmark name from any format
      const trimmed = output.trim();
      if (!trimmed) return "main";

      // Simple form: "main@origin" → "main"
      if (/^[\w.\-/]+@[\w.\-/]+$/.test(trimmed)) {
        return trimmed.slice(0, trimmed.indexOf("@"));
      }

      // Complex revset: extract first quoted string as bookmark name
      // e.g. latest(remote_bookmarks(exact:"main", ...)) → "main"
      const quoted = trimmed.match(/exact:"([^"]+)"/);
      if (quoted?.[1]) {
        return quoted[1];
      }

      // Plain bookmark name
      if (/^[\w.\-/]+$/.test(trimmed)) {
        return trimmed;
      }

      return "main";
    } catch {
      return "main";
    }
  }

  async refreshDefaultBranch(mainRepoPath: string): Promise<string | null> {
    try {
      await jj(mainRepoPath, ["git", "fetch"]);
      return await this.getDefaultBranch(mainRepoPath);
    } catch {
      return null;
    }
  }

  async fetchDefaultBranch(
    mainRepoPath: string,
    defaultBranch: string,
  ): Promise<string> {
    await jj(mainRepoPath, ["git", "fetch", "-b", defaultBranch]);
    const hash = await jj(mainRepoPath, [
      "log",
      "-r",
      defaultBranch,
      "--no-graph",
      "-T",
      "commit_id",
    ]);
    return hash;
  }

  async deleteLocalBranch(params: {
    mainRepoPath: string;
    branch: string;
  }): Promise<void> {
    await jj(params.mainRepoPath, ["bookmark", "forget", params.branch]);
  }

  async checkoutBranch(repoPath: string, branch: string): Promise<void> {
    await jj(repoPath, ["edit", branch]);
  }

  async safeCheckoutBranch(repoPath: string, branch: string): Promise<void> {
    await this.checkoutBranch(repoPath, branch);
  }

  // -------------------------------------------------------------------------
  // Ref / remote checks
  // -------------------------------------------------------------------------

  async refExistsLocally(repoPath: string, ref: string): Promise<boolean> {
    try {
      await jj(repoPath, [
        "log",
        "-r",
        gitRefToJjRevset(ref),
        "--no-graph",
        "--limit",
        "1",
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async hasOriginRemote(mainRepoPath: string): Promise<boolean> {
    try {
      const output = await jj(mainRepoPath, ["git", "remote", "list"]);
      return output.split("\n").some((line) => line.trim().startsWith("origin"));
    } catch {
      return false;
    }
  }

  async branchExistsOnRemote(
    repoPath: string,
    branch: string,
  ): Promise<BranchExistsOnRemoteResult> {
    try {
      const output = await jj(repoPath, [
        "bookmark",
        "list",
        "--all-remotes",
      ]);
      const remoteKey = `${branch}@`;
      const found = output
        .split("\n")
        .some((line) => line.trim().startsWith(remoteKey));
      return { status: found ? "exists" : "not_found" };
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getRepoRoot(path: string): Promise<string> {
    const { stdout } = await execWithShellEnv(
      "jj",
      ["--no-pager", "--color=never", "-R", path, "root"],
      { cwd: path },
    );
    return stdout.trim();
  }

  // -------------------------------------------------------------------------
  // Base branch config (backed by git config in colocated mode)
  // -------------------------------------------------------------------------

  async getBaseBranchConfig(
    repoPath: string,
    branch: string,
  ): Promise<string | null> {
    try {
      const key = `branch.${branch}.merge`;
      const value = await git(repoPath, ["config", "--local", key]);
      return value || null;
    } catch {
      return null;
    }
  }

  async setBaseBranchConfig(
    repoPath: string,
    branch: string,
    baseBranch: string,
  ): Promise<void> {
    await git(repoPath, [
      "config",
      "--local",
      `branch.${branch}.merge`,
      baseBranch,
    ]);
  }

  // -------------------------------------------------------------------------
  // Status & changes
  // -------------------------------------------------------------------------

  async getAheadBehindCount(params: {
    repoPath: string;
    defaultBranch: string;
  }): Promise<{ ahead: number; behind: number }> {
    const { repoPath, defaultBranch } = params;
    const remoteRef = `${defaultBranch}@origin`;

    try {
      const aheadOutput = await jj(repoPath, [
        "log",
        "-r",
        `::@ ~ ::${remoteRef}`,
        "--no-graph",
        "-T",
        'change_id ++ "\\n"',
      ]);
      const behindOutput = await jj(repoPath, [
        "log",
        "-r",
        `::${remoteRef} ~ ::@`,
        "--no-graph",
        "-T",
        'change_id ++ "\\n"',
      ]);

      const countLines = (s: string) =>
        s
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean).length;

      return {
        ahead: countLines(aheadOutput),
        behind: countLines(behindOutput),
      };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  async hasUncommittedChanges(workspacePath: string): Promise<boolean> {
    try {
      const output = await jj(workspacePath, ["diff", "--stat"]);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  async hasUnpushedCommits(workspacePath: string): Promise<boolean> {
    try {
      const output = await jj(workspacePath, [
        "log",
        "-r",
        "bookmarks() & mine() ~ remote_bookmarks()",
        "--no-graph",
        "-T",
        'change_id ++ "\\n"',
      ]);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Changes UI operations
  // -------------------------------------------------------------------------

  async commit(
    repoPath: string,
    message: string,
  ): Promise<{ hash: string }> {
    await jj(repoPath, ["commit", "-m", message]);
    const hash = await jj(repoPath, [
      "log",
      "-r",
      "@-",
      "--no-graph",
      "-T",
      "commit_id",
    ]);
    return { hash };
  }

  async push(
    repoPath: string,
    _options?: { setUpstream?: boolean },
  ): Promise<void> {
    const branch = await this.getCurrentBranch(repoPath);
    if (!branch) {
      throw new Error("No current bookmark to push");
    }
    await jj(repoPath, ["git", "push", "-b", branch]);
  }

  async pull(repoPath: string): Promise<void> {
    await jj(repoPath, ["git", "fetch"]);
  }

  async fetch(repoPath: string): Promise<void> {
    await jj(repoPath, ["git", "fetch"]);
  }

  async getDiff(repoPath: string, filePath?: string): Promise<string> {
    const args = ["diff", "--git"];
    if (filePath) {
      args.push(filePath);
    }
    return jj(repoPath, args);
  }

  // -------------------------------------------------------------------------
  // Staging — jj has no staging area; all are no-ops or delegated
  // -------------------------------------------------------------------------

  async stageFile(_repoPath: string, _filePath: string): Promise<void> {
    // no-op: jj has no staging area
  }

  async unstageFile(_repoPath: string, _filePath: string): Promise<void> {
    // no-op
  }

  async stageAll(_repoPath: string): Promise<void> {
    // no-op
  }

  async unstageAll(_repoPath: string): Promise<void> {
    // no-op
  }

  async discardFile(repoPath: string, filePath: string): Promise<void> {
    await jj(repoPath, ["restore", "--from", "@-", filePath]);
  }

  async discardAllUnstaged(repoPath: string): Promise<void> {
    await jj(repoPath, ["restore"]);
  }

  async stash(_repoPath: string): Promise<void> {
    // no-op: jj working copy is always a commit
  }

  async stashPop(_repoPath: string): Promise<void> {
    // no-op
  }
}
