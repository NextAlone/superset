import { projects, worktrees } from "@superset/local-db";
import { eq } from "drizzle-orm";
import { localDb } from "main/lib/local-db";

// Persisted base bookmark for a jj workspace. `assertRegisteredWorktree`
// accepts either a `worktrees.path` row or a `projects.mainRepoPath`,
// so we read both in priority order.
export function readPersistedJjBase(workspacePath: string): string | null {
	const worktreeRow = localDb
		.select({ baseBranch: worktrees.baseBranch })
		.from(worktrees)
		.where(eq(worktrees.path, workspacePath))
		.get();
	if (worktreeRow?.baseBranch?.trim()) {
		return worktreeRow.baseBranch.trim();
	}

	const projectRow = localDb
		.select({ workspaceBaseBranch: projects.workspaceBaseBranch })
		.from(projects)
		.where(eq(projects.mainRepoPath, workspacePath))
		.get();
	return projectRow?.workspaceBaseBranch?.trim() || null;
}
