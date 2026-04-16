import { resolve } from "node:path";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { getServiceForRootPath } from "../workspace-fs-service";
import { getSimpleGitWithShellPath } from "../workspaces/utils/git-client";
import {
	detectVcsType,
	getVcsProvider,
} from "../workspaces/utils/vcs";
import {
	gitCheckoutFile,
	gitDiscardAllStaged,
	gitDiscardAllUnstaged,
	gitStageAll,
	gitStageFile,
	gitStageFiles,
	gitStash,
	gitStashIncludeUntracked,
	gitStashPop,
	gitUnstageAll,
	gitUnstageFile,
	gitUnstageFiles,
} from "./security/git-commands";
import { assertRegisteredWorktree } from "./security/path-validation";
import { parseGitStatus } from "./utils/parse-status";
import { clearStatusCacheForWorktree } from "./utils/status-cache";

async function getUntrackedFilePaths(worktreePath: string): Promise<string[]> {
	assertRegisteredWorktree(worktreePath);
	const git = await getSimpleGitWithShellPath(worktreePath);
	const status = await git.status();
	return parseGitStatus(status).untracked.map((f) => f.path);
}

async function getStagedNewFilePaths(worktreePath: string): Promise<string[]> {
	assertRegisteredWorktree(worktreePath);
	const git = await getSimpleGitWithShellPath(worktreePath);
	const status = await git.status();
	return parseGitStatus(status)
		.staged.filter((f) => f.status === "added")
		.map((f) => f.path);
}

async function deleteFiles(
	worktreePath: string,
	filePaths: string[],
): Promise<void> {
	const service = getServiceForRootPath(worktreePath);
	await Promise.all(
		filePaths.map((filePath) =>
			service.deletePath({
				absolutePath: resolve(worktreePath, filePath),
				permanent: true,
			}),
		),
	);
}

export const createStagingRouter = () => {
	return router({
		stageFile: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePath: z.string(),
				}),
			)
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					await vcs.stageFile(input.worktreePath, input.filePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitStageFile(input.worktreePath, input.filePath);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		unstageFile: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePath: z.string(),
				}),
			)
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					await vcs.unstageFile(input.worktreePath, input.filePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitUnstageFile(input.worktreePath, input.filePath);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		discardChanges: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePath: z.string(),
				}),
			)
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					await vcs.discardFile(input.worktreePath, input.filePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitCheckoutFile(input.worktreePath, input.filePath);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		stageFiles: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePaths: z.array(z.string()).min(1),
				}),
			)
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					// jj has no staging area — no-op
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitStageFiles(input.worktreePath, input.filePaths);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		unstageFiles: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePaths: z.array(z.string()).min(1),
				}),
			)
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					// jj has no staging area — no-op
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitUnstageFiles(input.worktreePath, input.filePaths);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		stageAll: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					await vcs.stageAll(input.worktreePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitStageAll(input.worktreePath);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		unstageAll: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					await vcs.unstageAll(input.worktreePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitUnstageAll(input.worktreePath);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		deleteUntracked: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePath: z.string(),
				}),
			)
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				// Filesystem delete — VCS-agnostic, same for git and jj
				const service = getServiceForRootPath(input.worktreePath);
				await service.deletePath({
					absolutePath: resolve(input.worktreePath, input.filePath),
					permanent: true,
				});
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		discardAllUnstaged: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					// jj restore handles everything; no separate file deletion needed
					await vcs.discardAllUnstaged(input.worktreePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				// Must capture untracked files before git checkout removes status info
				const untrackedFiles = await getUntrackedFilePaths(input.worktreePath);
				await gitDiscardAllUnstaged(input.worktreePath);
				await deleteFiles(input.worktreePath, untrackedFiles);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		discardAllStaged: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					// jj has no staging; restore all changes back to parent
					await vcs.discardAllUnstaged(input.worktreePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				// Must capture staged new files before reset makes them untracked
				const stagedNewFiles = await getStagedNewFilePaths(input.worktreePath);
				await gitDiscardAllStaged(input.worktreePath);
				await deleteFiles(input.worktreePath, stagedNewFiles);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		stash: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					await vcs.stash(input.worktreePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitStash(input.worktreePath);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		stashIncludeUntracked: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					// jj working copy is always a commit — stash is a no-op
					await vcs.stash(input.worktreePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitStashIncludeUntracked(input.worktreePath);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),

		stashPop: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.mutation(async ({ input }): Promise<{ success: boolean }> => {
				if (detectVcsType(input.worktreePath) === "jj") {
					assertRegisteredWorktree(input.worktreePath);
					const vcs = getVcsProvider(input.worktreePath);
					await vcs.stashPop(input.worktreePath);
					clearStatusCacheForWorktree(input.worktreePath);
					return { success: true };
				}
				await gitStashPop(input.worktreePath);
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true };
			}),
	});
};
