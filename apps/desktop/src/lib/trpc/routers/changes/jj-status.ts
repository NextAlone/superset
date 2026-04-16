import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChangedFile, CommitInfo, GitChangesStatus } from "shared/changes-types";
import { execWithShellEnv } from "../workspaces/utils/shell-env";

// ---------------------------------------------------------------------------
// Local jj CLI helper (read-only — no repo lock needed)
// ---------------------------------------------------------------------------

async function jj(repoPath: string, args: string[]): Promise<string> {
	const { stdout } = await execWithShellEnv(
		"jj",
		["--no-pager", "--color=never", "-R", repoPath, ...args],
		{ cwd: repoPath },
	);
	return stdout.trim();
}

// ---------------------------------------------------------------------------
// Walk up directories to find the jj repo root
// ---------------------------------------------------------------------------

export function findJjRepoRoot(startPath: string): string | null {
	let current = startPath;
	while (true) {
		if (existsSync(join(current, ".jj"))) return current;
		const parent = join(current, "..");
		if (parent === current) return null;
		current = parent;
	}
}

// ---------------------------------------------------------------------------
// Parse `jj diff --summary` output into ChangedFile[]
//
// Line formats:
//   M path/to/file
//   A path/to/file
//   D path/to/file
//   R {old/path} => {new/path}
// ---------------------------------------------------------------------------

export function parseJjDiffSummary(output: string): ChangedFile[] {
	const files: ChangedFile[] = [];

	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const code = trimmed[0];
		const rest = trimmed.slice(2).trim();

		switch (code) {
			case "M":
				files.push({ path: rest, status: "modified", additions: 0, deletions: 0 });
				break;
			case "A":
				files.push({ path: rest, status: "added", additions: 0, deletions: 0 });
				break;
			case "D":
				files.push({ path: rest, status: "deleted", additions: 0, deletions: 0 });
				break;
			case "R": {
				// "R {old} => {new}"
				const arrowIdx = rest.indexOf(" => ");
				if (arrowIdx !== -1) {
					const oldPath = rest.slice(0, arrowIdx);
					const newPath = rest.slice(arrowIdx + 4);
					files.push({ path: newPath, oldPath, status: "renamed", additions: 0, deletions: 0 });
				} else {
					// Fallback: treat whole rest as path
					files.push({ path: rest, status: "renamed", additions: 0, deletions: 0 });
				}
				break;
			}
			default:
				// Unknown prefix — skip
				break;
		}
	}

	return files;
}

// ---------------------------------------------------------------------------
// Parse `jj diff --stat` output and fill additions/deletions on files
//
// Format:
//   path/to/file | N +++--
//   N file(s) changed, X insertions(+), Y deletions(-)
// ---------------------------------------------------------------------------

export function applyJjDiffStat(files: ChangedFile[], statOutput: string): void {
	if (files.length === 0) return;

	// Build a map from path → file for O(1) lookup
	const byPath = new Map<string, ChangedFile>();
	for (const f of files) {
		byPath.set(f.path, f);
		if (f.oldPath) byPath.set(f.oldPath, f);
	}

	const lines = statOutput.split("\n");
	// Last non-empty line is the summary — skip it
	const dataLines = lines.filter((l) => l.trim() && !l.trim().match(/^\d+ file/));

	for (const line of dataLines) {
		// " path/to/file | 12 +++---"
		const pipeIdx = line.lastIndexOf("|");
		if (pipeIdx === -1) continue;

		const path = line.slice(0, pipeIdx).trim();
		const statPart = line.slice(pipeIdx + 1).trim();

		// Try numeric: "12 +++---" or just "+++"
		const numMatch = statPart.match(/^(\d+)/);
		const plusCount = (statPart.match(/\+/g) ?? []).length;
		const minusCount = (statPart.match(/-/g) ?? []).length;

		let additions: number;
		let deletions: number;

		if (numMatch) {
			const total = Number.parseInt(numMatch[1], 10);
			const barTotal = plusCount + minusCount;
			if (barTotal > 0) {
				additions = Math.round((plusCount / barTotal) * total);
				deletions = total - additions;
			} else {
				additions = total;
				deletions = 0;
			}
		} else {
			additions = plusCount;
			deletions = minusCount;
		}

		const file = byPath.get(path);
		if (file) {
			file.additions = additions;
			file.deletions = deletions;
		}
	}
}

// ---------------------------------------------------------------------------
// Parse jj log output into CommitInfo[]
//
// Template produces lines: commit_id|short_id|message|author|date
// ---------------------------------------------------------------------------

function parseJjLog(output: string): CommitInfo[] {
	if (!output.trim()) return [];

	const commits: CommitInfo[] = [];
	for (const line of output.trim().split("\n")) {
		if (!line.trim()) continue;
		const parts = line.split("|");
		if (parts.length < 5) continue;

		const hash = parts[0]?.trim();
		const shortHash = parts[1]?.trim();
		const message = parts.slice(2, -2).join("|").trim();
		const author = parts[parts.length - 2]?.trim();
		const dateStr = parts[parts.length - 1]?.trim();

		if (!hash || !shortHash) continue;

		const parsed = dateStr ? new Date(dateStr) : new Date();
		const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

		commits.push({ hash, shortHash, message: message || "", author: author || "", date, files: [] });
	}

	return commits;
}

// ---------------------------------------------------------------------------
// Count non-empty lines from jj log output (used for ahead/behind)
// ---------------------------------------------------------------------------

function countLines(s: string): number {
	return s.split("\n").map((l) => l.trim()).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function computeJjStatus(
	worktreePath: string,
	defaultBranch: string,
): Promise<GitChangesStatus> {
	const repoRoot = findJjRepoRoot(worktreePath) ?? worktreePath;
	// Use remote ref if origin exists, otherwise fall back to local bookmark
	let baseRef = `${defaultBranch}@origin`;
	try {
		const remotes = await jj(repoRoot, ["git", "remote", "list"]);
		if (!remotes.includes("origin")) {
			baseRef = defaultBranch;
		}
	} catch {
		baseRef = defaultBranch;
	}

	// Run all queries in parallel
	const [
		diffSummaryOut,
		diffStatOut,
		bookmarkOut,
		aheadOut,
		behindOut,
		logOut,
		againstBaseSummaryOut,
		againstBaseStatOut,
	] = await Promise.allSettled([
		jj(repoRoot, ["diff", "--summary"]),
		jj(repoRoot, ["diff", "--stat"]),
		jj(repoRoot, ["log", "-r", "@", "--no-graph", "-T", "bookmarks"]),
		jj(repoRoot, ["log", "-r", `::@ ~ ::${baseRef}`, "--no-graph", "-T", 'change_id ++ "\\n"']),
		jj(repoRoot, ["log", "-r", `::${baseRef} ~ ::@`, "--no-graph", "-T", 'change_id ++ "\\n"']),
		jj(repoRoot, [
			"log",
			"-r", `::@ ~ ::${baseRef}`,
			"--no-graph",
			"-T",
			'commit_id ++ "|" ++ commit_id.short(7) ++ "|" ++ description.first_line() ++ "|" ++ author.name() ++ "|" ++ author.timestamp().format("%Y-%m-%dT%H:%M:%S%z") ++ "\\n"',
		]),
		jj(repoRoot, ["diff", "--summary", "--from", baseRef, "--to", "@"]),
		jj(repoRoot, ["diff", "--stat", "--from", baseRef, "--to", "@"]),
	]);

	// Resolve or use empty string on failure
	const resolve = (r: PromiseSettledResult<string>) =>
		r.status === "fulfilled" ? r.value : "";

	const diffSummary = resolve(diffSummaryOut);
	const diffStat = resolve(diffStatOut);
	const bookmarkRaw = resolve(bookmarkOut);
	const aheadRaw = resolve(aheadOut);
	const behindRaw = resolve(behindOut);
	const logRaw = resolve(logOut);
	const againstBaseSummary = resolve(againstBaseSummaryOut);
	const againstBaseStat = resolve(againstBaseStatOut);

	// Current branch (first bookmark, strip trailing '*')
	const branch = bookmarkRaw
		? (bookmarkRaw.split(/\s/)[0]?.replace(/\*$/, "") ?? "")
		: "";

	// Working copy changes → unstaged
	const unstaged = parseJjDiffSummary(diffSummary);
	applyJjDiffStat(unstaged, diffStat);

	// Against-base changes
	const againstBase = parseJjDiffSummary(againstBaseSummary);
	applyJjDiffStat(againstBase, againstBaseStat);

	// Commits
	const commits = parseJjLog(logRaw);

	// Ahead / behind
	const ahead = countLines(aheadRaw);
	const behind = countLines(behindRaw);

	return {
		branch,
		defaultBranch,
		againstBase,
		commits,
		staged: [],
		unstaged,
		untracked: [],
		ahead,
		behind,
		// jj push/pull counts not yet computed
		pushCount: 0,
		pullCount: 0,
		hasUpstream: false,
	};
}
