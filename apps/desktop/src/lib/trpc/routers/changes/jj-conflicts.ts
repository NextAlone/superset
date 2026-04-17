import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type ConflictRegion,
	parseJjConflictMarkers,
} from "shared/jj-conflict-parser";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { findJjRepoRoot } from "./jj-status";
import { assertRegisteredWorktree } from "./security/path-validation";
import { jj } from "./utils/jj-cli";
import { clearStatusCacheForWorktree } from "./utils/status-cache";

export interface ConflictFile {
	path: string;
}

export type { ConflictRegion };

export interface ConflictContent {
	raw: string;
	regions: ConflictRegion[];
}

function parseConflictList(output: string): ConflictFile[] {
	const files: ConflictFile[] = [];
	for (const rawLine of output.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		// jj prints something like: "path/to/file    2-sided conflict"
		// First whitespace-separated token is the relative path.
		const path = line.split(/\s+/)[0];
		if (path) files.push({ path });
	}
	return files;
}

export function createJjConflictsRouter() {
	return router({
		jjConflictList: publicProcedure
			.input(z.object({ worktreePath: z.string() }))
			.query(async ({ input }): Promise<ConflictFile[]> => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
				try {
					const output = await jj(repoRoot, ["resolve", "--list"]);
					return parseConflictList(output);
				} catch {
					// `jj resolve --list` exits non-zero when there are no conflicts.
					return [];
				}
			}),

		jjConflictContent: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePath: z.string().min(1),
				}),
			)
			.query(async ({ input }): Promise<ConflictContent> => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
				const fullPath = join(repoRoot, input.filePath);
				const raw = await readFile(fullPath, "utf-8");
				return { raw, regions: parseJjConflictMarkers(raw) };
			}),

		jjConflictResolve: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					filePath: z.string().min(1),
					resolvedContent: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
				const fullPath = join(repoRoot, input.filePath);
				await writeFile(fullPath, input.resolvedContent, "utf-8");
				clearStatusCacheForWorktree(input.worktreePath);
				return { success: true as const };
			}),
	});
}
