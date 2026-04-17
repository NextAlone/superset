import { z } from "zod";
import { publicProcedure, router } from "../..";
import { findJjRepoRoot } from "./jj-status";
import { assertRegisteredWorktree } from "./security/path-validation";
import { jj } from "./utils/jj-cli";
import { clearStatusCacheForWorktree } from "./utils/status-cache";

// ---------------------------------------------------------------------------
// Router — all jj mutations (describe, commit, squash, squash-into, rebase,
// edit, discard, bookmark CRUD). Queries stay in jj-change-status.ts.
// ---------------------------------------------------------------------------

const BOOKMARK_NAME_REGEX = /^[a-zA-Z0-9._/-]+$/;

export function createJjMutationsRouter() {
	return router({
		// ---------------------------------------------------------------
		// describe — update description of current change
		// ---------------------------------------------------------------
		jjDescribe: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					message: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["describe", "-m", input.message]);
				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// commit — commit current change and create new empty change
		// ---------------------------------------------------------------
		jjCommit: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					message: z.string().min(1, "Commit message must be non-empty"),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["commit", "-m", input.message]);

				// Get committed change hash (now at @-)
				const hash = await jj(repoRoot, [
					"log",
					"-r",
					"@-",
					"--no-graph",
					"-T",
					"commit_id",
				]);

				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const, hash };
			}),

		// ---------------------------------------------------------------
		// squash — squash current change into parent
		// ---------------------------------------------------------------
		jjSquash: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					message: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				// Always pass -m to avoid interactive editor hang
				const msg = input.message ?? "";
				await jj(repoRoot, ["squash", "-m", msg]);

				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// edit — move working copy to an existing change
		// ---------------------------------------------------------------
		jjEdit: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					changeId: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["edit", input.changeId]);
				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// new — create a new empty change as a child of <changeId>
		// ---------------------------------------------------------------
		jjNew: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					changeId: z.string().min(1),
					message: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				const args = ["new", input.changeId];
				if (input.message) args.push("-m", input.message);
				await jj(repoRoot, args);
				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// squashInto — squash current @ into a specific target change
		// ---------------------------------------------------------------
		jjSquashInto: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					targetChangeId: z.string().min(1),
					message: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				// Always pass -m to avoid interactive editor hang
				const msg = input.message ?? "";
				await jj(repoRoot, [
					"squash",
					"--into",
					input.targetChangeId,
					"-m",
					msg,
				]);
				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// rebase — move current branch (-b @) onto a destination
		// Uses -b @ -d <dest> per jj-only policy (never -r).
		// ---------------------------------------------------------------
		jjRebase: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					destination: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["rebase", "-b", "@", "-d", input.destination]);
				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// abandon — drop a change; descendants rebased onto its parent
		// ---------------------------------------------------------------
		jjAbandon: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					changeId: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["abandon", input.changeId]);
				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// duplicate — copy a change as a sibling (no history rewrite)
		// ---------------------------------------------------------------
		jjDuplicate: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					changeId: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["duplicate", input.changeId]);
				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// backout — apply reverse of a change onto destination (default @)
		// ---------------------------------------------------------------
		jjBackout: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					changeId: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["backout", "-r", input.changeId]);
				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// discardFile — restore a single file to parent version
		// ---------------------------------------------------------------
		jjDiscardFile: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePath: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["restore", input.filePath]);

				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// discardAll — restore all files to parent version
		// ---------------------------------------------------------------
		jjDiscardAll: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["restore"]);

				clearStatusCacheForWorktree(input.worktreePath);

				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// bookmarkCreate — create a local bookmark at a revision (default @)
		// ---------------------------------------------------------------
		jjBookmarkCreate: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					name: z
						.string()
						.min(1)
						.regex(BOOKMARK_NAME_REGEX, "Invalid bookmark name"),
					revision: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				const args = ["bookmark", "create", input.name];
				if (input.revision) args.push("-r", input.revision);
				await jj(repoRoot, args);

				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// bookmarkDelete — forget a bookmark (local only)
		// ---------------------------------------------------------------
		jjBookmarkDelete: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					name: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, ["bookmark", "forget", input.name]);

				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// bookmarkRename — use native jj bookmark rename (preserves tracking)
		// ---------------------------------------------------------------
		jjBookmarkRename: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					oldName: z.string().min(1),
					newName: z
						.string()
						.min(1)
						.regex(BOOKMARK_NAME_REGEX, "Invalid bookmark name"),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, [
					"bookmark",
					"rename",
					input.oldName,
					input.newName,
				]);

				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true as const };
			}),

		// ---------------------------------------------------------------
		// bookmarkMove — set bookmark to point at revision
		// ---------------------------------------------------------------
		jjBookmarkMove: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					name: z.string().min(1),
					revision: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;

				await jj(repoRoot, [
					"bookmark",
					"set",
					input.name,
					"-r",
					input.revision,
				]);

				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true as const };
			}),
	});
}
