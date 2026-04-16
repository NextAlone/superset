import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { GitProvider } from "./git-provider";
import { JjProvider } from "./jj-provider";
import type { VcsProvider, VcsType } from "./types";

// Re-export types
export type {
  VcsProvider,
  VcsType,
  ExternalWorkspace,
  BranchExistsOnRemoteResult,
} from "./types";

// Re-export git-specific utilities (PR handling, branch naming, etc.)
export {
  generateBranchName,
  getAuthorPrefix,
  getBranchPrefix,
  getGitHubUsername,
  getGitAuthorName,
  getPrInfo,
  parsePrUrl,
  getPrLocalBranchName,
  createWorktreeFromPr,
  sanitizeBranchName,
  sanitizeBranchNameWithMaxLength,
  sanitizeAuthorPrefix,
  sanitizeGitError,
  checkBranchCheckoutSafety,
  checkNeedsRebase,
  detectBaseBranch,
  getStatusNoLock,
  NotGitRepoError,
} from "../git";

export type { PullRequestInfo } from "../git";

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
      console.warn(
        `[vcs] jj repo detected but CLI not found — falling back to GitProvider`,
      );
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

export async function getRepoRoot(path: string): Promise<string> {
  // Try jj first — works for both colocated and pure jj repos
  try {
    const jjProvider = new JjProvider();
    const root = await jjProvider.getRepoRoot(path);
    if (root && existsSync(join(root, ".jj"))) return root;
  } catch {
    // jj not available or not a jj repo
  }
  const gitProvider = new GitProvider();
  return gitProvider.getRepoRoot(path);
}
