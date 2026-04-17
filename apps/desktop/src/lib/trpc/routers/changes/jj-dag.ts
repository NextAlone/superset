import { z } from "zod";
import { publicProcedure, router } from "../..";
import { findJjRepoRoot } from "./jj-status";
import { assertRegisteredWorktree } from "./security/path-validation";
import { jj } from "./utils/jj-cli";

export interface DagNode {
	changeId: string;
	commitId: string;
	shortCommitId: string;
	description: string;
	bookmarks: string[];
	author: string;
	timestamp: string;
	parentChangeIds: string[];
	isWorkingCopy: boolean;
	isEmpty: boolean;
	hasConflicts: boolean;
}

export interface DagResult {
	nodes: DagNode[];
	truncated: boolean;
	baseBookmark: string;
}

const MAX_NODES = 50;

// Keep fields tab-separated so description/bookmarks can contain spaces.
const DAG_TEMPLATE = [
	"change_id.shortest()",
	"commit_id",
	"commit_id.short(7)",
	"description.first_line()",
	"bookmarks",
	"author.name()",
	'author.timestamp().format("%Y-%m-%dT%H:%M:%S%z")',
	'parents.map(|p| p.change_id().shortest()).join(",")',
	"current_working_copy",
	"empty",
	"conflict",
].join(' ++ "\\t" ++ ');

function parseDagOutput(output: string): DagNode[] {
	const nodes: DagNode[] = [];
	for (const rawLine of output.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const parts = line.split("\t");
		if (parts.length < 11) continue;
		const [
			changeId,
			commitId,
			shortCommitId,
			description,
			bookmarksRaw,
			author,
			timestamp,
			parentsRaw,
			isWorkingCopyRaw,
			isEmptyRaw,
			hasConflictsRaw,
		] = parts;
		nodes.push({
			changeId: changeId ?? "",
			commitId: commitId ?? "",
			shortCommitId: shortCommitId ?? "",
			description: description ?? "",
			bookmarks: (bookmarksRaw ?? "").split(/\s+/).filter(Boolean),
			author: author ?? "",
			timestamp: timestamp ?? "",
			parentChangeIds: (parentsRaw ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean),
			isWorkingCopy: (isWorkingCopyRaw ?? "").trim() === "true",
			isEmpty: (isEmptyRaw ?? "").trim() === "true",
			hasConflicts: (hasConflictsRaw ?? "").trim() === "true",
		});
	}
	return nodes;
}

async function resolveBaseRef(
	repoRoot: string,
	baseBookmark: string,
): Promise<string> {
	try {
		const remotes = await jj(repoRoot, ["git", "remote", "list"]);
		if (remotes.includes("origin")) return `${baseBookmark}@origin`;
	} catch {
		// no remote — fall back to local
	}
	return baseBookmark;
}

export function createJjDagRouter() {
	return router({
		jjGetDag: publicProcedure
			.input(
				z.object({
					worktreePath: z.string(),
					baseBookmark: z.string().optional(),
				}),
			)
			.query(async ({ input }): Promise<DagResult> => {
				assertRegisteredWorktree(input.worktreePath);
				const repoRoot =
					findJjRepoRoot(input.worktreePath) ?? input.worktreePath;
				const baseBookmark = input.baseBookmark ?? "main";
				const baseRef = await resolveBaseRef(repoRoot, baseBookmark);

				// jj default log revset; narrow further via `revset-aliases.'immutable_heads()'`
				const revset = `present(@) | ancestors(immutable_heads().., 2) | present(trunk()) | present(${baseRef})`;

				const output = await jj(repoRoot, [
					"log",
					"-r",
					revset,
					"--no-graph",
					"-T",
					`${DAG_TEMPLATE} ++ "\\n"`,
				]);

				const all = parseDagOutput(output);
				const truncated = all.length > MAX_NODES;
				return {
					nodes: truncated ? all.slice(0, MAX_NODES) : all,
					truncated,
					baseBookmark,
				};
			}),
	});
}
