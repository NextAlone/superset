import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { findJjRepoRoot } from "./jj-status";
import { assertRegisteredWorktree } from "./security/path-validation";
import { jj } from "./utils/jj-cli";
import { clearStatusCacheForWorktree } from "./utils/status-cache";

export interface ConflictFile {
	path: string;
}

export interface ConflictRegion {
	base: string;
	left: string;
	right: string;
}

export interface ConflictContent {
	raw: string;
	regions: ConflictRegion[];
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

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

export function parseJjConflictMarkers(content: string): ConflictRegion[] {
	// jj conflict markers (diff3-like). Example:
	//   <<<<<<< Conflict 1 of N
	//   +++++++ Contents of side #1
	//   <left content>
	//   ------- Contents of base
	//   <base content>
	//   +++++++ Contents of side #2
	//   <right content>
	//   >>>>>>> Conflict 1 of N ends
	const regions: ConflictRegion[] = [];
	const lines = content.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (line.startsWith("<<<<<<<")) {
			// Find the terminating >>>>>>> line
			let end = i + 1;
			while (end < lines.length && !(lines[end] ?? "").startsWith(">>>>>>>")) {
				end += 1;
			}
			// Parse the sub-sections between the "+++++++" / "-------" markers.
			const inner = lines.slice(i + 1, end);
			let current: "side1" | "base" | "side2" | null = null;
			const buffers: { side1: string[]; base: string[]; side2: string[] } = {
				side1: [],
				base: [],
				side2: [],
			};
			let seenSide1 = false;
			for (const innerLine of inner) {
				if (innerLine.startsWith("+++++++")) {
					current = seenSide1 ? "side2" : "side1";
					seenSide1 = true;
					continue;
				}
				if (innerLine.startsWith("-------")) {
					current = "base";
					continue;
				}
				if (current) buffers[current].push(innerLine);
			}
			regions.push({
				left: buffers.side1.join("\n"),
				base: buffers.base.join("\n"),
				right: buffers.side2.join("\n"),
			});
			i = end + 1;
			continue;
		}
		i += 1;
	}
	return regions;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

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
