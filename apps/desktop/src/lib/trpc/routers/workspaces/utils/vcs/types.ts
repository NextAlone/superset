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
	workspaceExists(
		mainRepoPath: string,
		workspacePath: string,
	): Promise<boolean>;
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
	fetchDefaultBranch(
		mainRepoPath: string,
		defaultBranch: string,
	): Promise<string>;
	deleteLocalBranch(params: {
		mainRepoPath: string;
		branch: string;
	}): Promise<void>;
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
	setBaseBranchConfig(
		repoPath: string,
		branch: string,
		baseBranch: string,
	): Promise<void>;

	// --- Status & changes ---
	getAheadBehindCount(params: {
		repoPath: string;
		defaultBranch: string;
	}): Promise<{ ahead: number; behind: number }>;
	hasUncommittedChanges(workspacePath: string): Promise<boolean>;
	hasUnpushedCommits(workspacePath: string): Promise<boolean>;

	// --- Changes UI operations ---
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
