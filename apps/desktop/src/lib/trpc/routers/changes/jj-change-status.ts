import type { ChangedFile } from "shared/changes-types";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { detectVcsType, getVcsProvider } from "../workspaces/utils/vcs";
import {
	applyJjDiffStat,
	findJjRepoRoot,
	parseJjDiffSummary,
} from "./jj-status";
import { assertRegisteredWorktree } from "./security/path-validation";
import { readPersistedJjBase } from "./utils/jj-base-branch";
import { jj } from "./utils/jj-cli";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JjRevision {
	changeId: string;
	commitId: string;
	shortCommitId: string;
	description: string;
	author: string;
	timestamp: string;
	bookmarks: string[];
	isEmpty: boolean;
}

export interface JjChangeStatus {
	changeId: string;
	commitId: string;
	description: string;
	bookmark: string | null;
	author: string;
	timestamp: string;

	files: ChangedFile[];

	baseBookmark: string;
	againstBase: ChangedFile[];
	ahead: number;
	behind: number;

	ancestors: JjRevision[];

	hasConflicts: boolean;
}

// ---------------------------------------------------------------------------
// Resolve base ref (prefer remote bookmark if origin exists)
// ---------------------------------------------------------------------------

async function resolveBaseRef(
	repoRoot: string,
	baseBookmark: string,
): Promise<string> {
	try {
		const remotes = await jj(repoRoot, ["git", "remote", "list"]);
		if (remotes.includes("origin")) {
			return `${baseBookmark}@origin`;
		}
	} catch {
		// no remote — fall back to local
	}
	return baseBookmark;
}

// ---------------------------------------------------------------------------
// Helpers to resolve Promise.allSettled results
// ---------------------------------------------------------------------------

function resolve(r: PromiseSettledResult<string>): string {
	return r.status === "fulfilled" ? r.value : "";
}

// ---------------------------------------------------------------------------
// Parse ancestor log lines (tab-separated fields)
// ---------------------------------------------------------------------------

function parseAncestors(output: string): JjRevision[] {
	if (!output.trim()) return [];
	const revisions: JjRevision[] = [];
	for (const line of output.trim().split("\n")) {
		if (!line.trim()) continue;
		const parts = line.split("\t");
		if (parts.length < 7) continue;
		const [
			changeId,
			commitId,
			shortCommitId,
			description,
			author,
			timestamp,
			bookmarksRaw,
			emptyRaw,
		] = parts;
		revisions.push({
			changeId: changeId ?? "",
			commitId: commitId ?? "",
			shortCommitId: shortCommitId ?? "",
			description: description ?? "",
			author: author ?? "",
			timestamp: timestamp ?? "",
			bookmarks: (bookmarksRaw ?? "").split(/\s+/).filter(Boolean),
			isEmpty: emptyRaw?.trim() === "true",
		});
	}
	return revisions;
}

// ---------------------------------------------------------------------------
// Count non-empty lines
// ---------------------------------------------------------------------------

function countLines(s: string): number {
	return s
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createJjRouter() {
	return router({
		// ---------------------------------------------------------------
		// getChangeStatus — read-only query for current jj working copy
		// ---------------------------------------------------------------
		jjGetChangeStatus: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					baseBookmark: z.string().optional(),
				}),
			)
			.query(async ({ input }): Promise<JjChangeStatus> => {
				assertRegisteredWorktree(input.worktreePath);

				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
				const baseBookmark = input.baseBookmark ?? "main";
				const baseRef = await resolveBaseRef(repoRoot, baseBookmark);

				const ANCESTOR_TEMPLATE = [
					"change_id.shortest()",
					"commit_id",
					"commit_id.short(7)",
					"description.first_line()",
					"author.name()",
					'author.timestamp().format("%Y-%m-%dT%H:%M:%S%z")',
					"bookmarks",
					"empty",
				].join(' ++ "\\t" ++ ');

				const [
					metaOut,
					diffSummaryOut,
					diffStatOut,
					againstBaseSummaryOut,
					againstBaseStatOut,
					ancestorsOut,
					aheadOut,
					behindOut,
				] = await Promise.allSettled([
					// Current change metadata
					jj(repoRoot, [
						"log",
						"-r",
						"@",
						"--no-graph",
						"-T",
						'change_id.shortest() ++ "\\t" ++ commit_id ++ "\\t" ++ description.first_line() ++ "\\t" ++ author.name() ++ "\\t" ++ author.timestamp().format("%Y-%m-%dT%H:%M:%S%z") ++ "\\t" ++ bookmarks ++ "\\t" ++ conflict',
					]),
					// Working copy files
					jj(repoRoot, ["diff", "--summary"]),
					jj(repoRoot, ["diff", "--stat"]),
					// Against base
					jj(repoRoot, ["diff", "--summary", "--from", baseRef, "--to", "@"]),
					jj(repoRoot, ["diff", "--stat", "--from", baseRef, "--to", "@"]),
					// Ancestors
					jj(repoRoot, [
						"log",
						"-r",
						`::@ ~ ::${baseRef}`,
						"--no-graph",
						"-T",
						`${ANCESTOR_TEMPLATE} ++ "\\n"`,
					]),
					// Ahead count
					jj(repoRoot, [
						"log",
						"-r",
						`::@ ~ ::${baseRef}`,
						"--no-graph",
						"-T",
						'change_id ++ "\\n"',
					]),
					// Behind count
					jj(repoRoot, [
						"log",
						"-r",
						`::${baseRef} ~ ::@`,
						"--no-graph",
						"-T",
						'change_id ++ "\\n"',
					]),
				]);

				// Parse metadata
				const metaRaw = resolve(metaOut);
				const metaParts = metaRaw.split("\t");
				const changeId = metaParts[0] ?? "";
				const commitId = metaParts[1] ?? "";
				const description = metaParts[2] ?? "";
				const author = metaParts[3] ?? "";
				const timestamp = metaParts[4] ?? "";
				const bookmarkRaw = metaParts[5] ?? "";
				const conflictRaw = metaParts[6] ?? "";

				const bookmark = bookmarkRaw
					? (bookmarkRaw.split(/\s/)[0]?.replace(/\*$/, "") ?? null)
					: null;

				// Working copy files
				const files = parseJjDiffSummary(resolve(diffSummaryOut));
				applyJjDiffStat(files, resolve(diffStatOut));

				// Against base files
				const againstBase = parseJjDiffSummary(resolve(againstBaseSummaryOut));
				applyJjDiffStat(againstBase, resolve(againstBaseStatOut));

				// Ancestors
				const ancestors = parseAncestors(resolve(ancestorsOut));

				// Ahead / behind
				const ahead = countLines(resolve(aheadOut));
				const behind = countLines(resolve(behindOut));

				return {
					changeId,
					commitId,
					description,
					bookmark,
					author,
					timestamp,
					files,
					baseBookmark,
					againstBase,
					ahead,
					behind,
					ancestors,
					hasConflicts: conflictRaw.trim() === "true",
				};
			}),

		// ---------------------------------------------------------------
		// sidebar status — lightweight ahead/base query for the workspace
		// list. Starship-style "<base>~<ahead>" display.
		// Returns null when the workspace is not a jj repo.
		// ---------------------------------------------------------------
		jjGetSidebarStatus: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.query(
				async ({
					input,
				}): Promise<{
					baseBookmark: string;
					ahead: number;
					hasConflicts: boolean;
				} | null> => {
					assertRegisteredWorktree(input.worktreePath);
					if (detectVcsType(input.worktreePath) !== "jj") return null;

					const repoRoot =
						findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
					const provider = getVcsProvider(input.worktreePath);
					const persisted = readPersistedJjBase(input.worktreePath);
					const baseBookmark =
						persisted ??
						(await provider.getDefaultBranch(input.worktreePath)) ??
						"main";
					const baseRef = await resolveBaseRef(repoRoot, baseBookmark);

					try {
						const [aheadOut, conflictOut] = await Promise.allSettled([
							jj(repoRoot, [
								"log",
								"-r",
								`::@ ~ ::${baseRef}`,
								"--no-graph",
								"-T",
								'change_id ++ "\\n"',
							]),
							jj(repoRoot, ["log", "-r", "@", "--no-graph", "-T", "conflict"]),
						]);

						return {
							baseBookmark,
							ahead: countLines(resolve(aheadOut)),
							hasConflicts: resolve(conflictOut).trim() === "true",
						};
					} catch {
						return { baseBookmark, ahead: 0, hasConflicts: false };
					}
				},
			),
	});
}
