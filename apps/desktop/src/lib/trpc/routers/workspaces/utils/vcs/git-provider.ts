import { access } from "node:fs/promises";
import {
	gitCheckoutFile,
	gitDiscardAllUnstaged,
	gitStageAll,
	gitStageFile,
	gitStash,
	gitStashPop,
	gitUnstageAll,
	gitUnstageFile,
} from "../../../changes/security/git-commands";
import {
	pushCurrentBranch,
	pushWithResolvedUpstream,
} from "../../../changes/utils/git-push";
import {
	getBranchBaseConfig,
	setBranchBaseConfig,
} from "../base-branch-config";
import {
	branchExistsOnRemote,
	checkoutBranch,
	createWorktree,
	createWorktreeFromExistingBranch,
	deleteLocalBranch,
	fetchDefaultBranch,
	getAheadBehindCount,
	getBranchWorktreePath,
	getCurrentBranch,
	getDefaultBranch,
	getGitRoot,
	hasOriginRemote,
	hasUncommittedChanges,
	hasUnpushedCommits,
	listBranches,
	listExternalWorktrees,
	refExistsLocally,
	refreshDefaultBranch,
	removeWorktree,
	safeCheckoutBranch,
	worktreeExists,
} from "../git";
import { getSimpleGitWithShellPath } from "../git-client";
import type {
	BranchExistsOnRemoteResult,
	ExternalWorkspace,
	VcsProvider,
} from "./types";

export class GitProvider implements VcsProvider {
	readonly type = "git" as const;
	readonly supportsStaging = true;

	// --- Workspace lifecycle ---

	async createWorkspace(params: {
		mainRepoPath: string;
		branch: string;
		workspacePath: string;
		startPoint?: string;
	}): Promise<void> {
		await createWorktree(
			params.mainRepoPath,
			params.branch,
			params.workspacePath,
			params.startPoint,
		);
	}

	async createWorkspaceFromExistingBranch(params: {
		mainRepoPath: string;
		branch: string;
		workspacePath: string;
	}): Promise<void> {
		await createWorktreeFromExistingBranch({
			mainRepoPath: params.mainRepoPath,
			branch: params.branch,
			worktreePath: params.workspacePath,
		});
	}

	async removeWorkspace(
		mainRepoPath: string,
		workspacePath: string,
	): Promise<void> {
		await removeWorktree(mainRepoPath, workspacePath);
	}

	async workspaceExists(
		mainRepoPath: string,
		workspacePath: string,
	): Promise<boolean> {
		// Check both disk existence and worktree registration
		try {
			await access(workspacePath);
		} catch {
			return false;
		}
		return worktreeExists(mainRepoPath, workspacePath);
	}

	async listExternalWorkspaces(
		mainRepoPath: string,
	): Promise<ExternalWorkspace[]> {
		const worktrees = await listExternalWorktrees(mainRepoPath);
		return worktrees.map((wt) => ({
			path: wt.path,
			branch: wt.branch,
			isDetached: wt.isDetached,
			isBare: wt.isBare,
		}));
	}

	async getBranchWorkspacePath(params: {
		mainRepoPath: string;
		branch: string;
	}): Promise<string | null> {
		return getBranchWorktreePath(params);
	}

	// --- Branch/bookmark operations ---

	async getCurrentBranch(repoPath: string): Promise<string | null> {
		return getCurrentBranch(repoPath);
	}

	async listBranches(
		repoPath: string,
		options?: { fetch?: boolean },
	): Promise<{ local: string[]; remote: string[] }> {
		return listBranches(repoPath, options);
	}

	async getDefaultBranch(mainRepoPath: string): Promise<string> {
		return getDefaultBranch(mainRepoPath);
	}

	async refreshDefaultBranch(mainRepoPath: string): Promise<string | null> {
		return refreshDefaultBranch(mainRepoPath);
	}

	async fetchDefaultBranch(
		mainRepoPath: string,
		defaultBranch: string,
	): Promise<string> {
		return fetchDefaultBranch(mainRepoPath, defaultBranch);
	}

	async deleteLocalBranch(params: {
		mainRepoPath: string;
		branch: string;
	}): Promise<void> {
		await deleteLocalBranch(params);
	}

	async checkoutBranch(repoPath: string, branch: string): Promise<void> {
		await checkoutBranch(repoPath, branch);
	}

	async safeCheckoutBranch(repoPath: string, branch: string): Promise<void> {
		await safeCheckoutBranch(repoPath, branch);
	}

	// --- Ref/remote checks ---

	async refExistsLocally(repoPath: string, ref: string): Promise<boolean> {
		return refExistsLocally(repoPath, ref);
	}

	async hasOriginRemote(mainRepoPath: string): Promise<boolean> {
		return hasOriginRemote(mainRepoPath);
	}

	async branchExistsOnRemote(
		repoPath: string,
		branch: string,
	): Promise<BranchExistsOnRemoteResult> {
		const result = await branchExistsOnRemote(repoPath, branch);
		// BranchExistsResult from git.ts is structurally identical to BranchExistsOnRemoteResult
		return result as BranchExistsOnRemoteResult;
	}

	async getRepoRoot(path: string): Promise<string> {
		return getGitRoot(path);
	}

	// --- Base branch config ---

	async getBaseBranchConfig(
		repoPath: string,
		branch: string,
	): Promise<string | null> {
		const config = await getBranchBaseConfig({ repoPath, branch });
		return config.compareBaseBranch;
	}

	async setBaseBranchConfig(
		repoPath: string,
		branch: string,
		baseBranch: string,
	): Promise<void> {
		await setBranchBaseConfig({
			repoPath,
			branch,
			compareBaseBranch: baseBranch,
			isExplicit: true,
		});
	}

	// --- Status & changes ---

	async getAheadBehindCount(params: {
		repoPath: string;
		defaultBranch: string;
	}): Promise<{ ahead: number; behind: number }> {
		return getAheadBehindCount(params);
	}

	async hasUncommittedChanges(workspacePath: string): Promise<boolean> {
		return hasUncommittedChanges(workspacePath);
	}

	async hasUnpushedCommits(workspacePath: string): Promise<boolean> {
		return hasUnpushedCommits(workspacePath);
	}

	// --- Changes UI operations ---

	async commit(repoPath: string, message: string): Promise<{ hash: string }> {
		const git = await getSimpleGitWithShellPath(repoPath);
		const result = await git.commit(message);
		return { hash: result.commit };
	}

	async push(
		repoPath: string,
		options?: { setUpstream?: boolean },
	): Promise<void> {
		const git = await getSimpleGitWithShellPath(repoPath);
		const localBranch = await getCurrentBranch(repoPath);
		if (!localBranch) {
			throw new Error(
				"Cannot push from detached HEAD. Please checkout a branch first.",
			);
		}
		if (options?.setUpstream) {
			await pushWithResolvedUpstream({
				git,
				worktreePath: repoPath,
				localBranch,
			});
		} else {
			await pushCurrentBranch({ git, worktreePath: repoPath, localBranch });
		}
	}

	async pull(repoPath: string): Promise<void> {
		const git = await getSimpleGitWithShellPath(repoPath);
		await git.pull(["--rebase"]);
	}

	async fetch(repoPath: string): Promise<void> {
		const git = await getSimpleGitWithShellPath(repoPath);
		await git.fetch();
	}

	async getDiff(repoPath: string, filePath?: string): Promise<string> {
		const git = await getSimpleGitWithShellPath(repoPath);
		if (filePath) {
			return git.diff([filePath]);
		}
		return git.diff();
	}

	// --- Staging ---

	async stageFile(repoPath: string, filePath: string): Promise<void> {
		await gitStageFile(repoPath, filePath);
	}

	async unstageFile(repoPath: string, filePath: string): Promise<void> {
		await gitUnstageFile(repoPath, filePath);
	}

	async stageAll(repoPath: string): Promise<void> {
		await gitStageAll(repoPath);
	}

	async unstageAll(repoPath: string): Promise<void> {
		await gitUnstageAll(repoPath);
	}

	async discardFile(repoPath: string, filePath: string): Promise<void> {
		await gitCheckoutFile(repoPath, filePath);
	}

	async discardAllUnstaged(repoPath: string): Promise<void> {
		await gitDiscardAllUnstaged(repoPath);
	}

	async stash(repoPath: string): Promise<void> {
		await gitStash(repoPath);
	}

	async stashPop(repoPath: string): Promise<void> {
		await gitStashPop(repoPath);
	}
}
