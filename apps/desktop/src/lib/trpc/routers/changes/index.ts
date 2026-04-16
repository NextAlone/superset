import { router } from "../..";
import { createBranchesRouter } from "./branches";
import { createFileContentsRouter } from "./file-contents";
import { createGitOperationsRouter } from "./git-operations";
import { createJjRouter } from "./jj-change-status";
import { createJjConflictsRouter } from "./jj-conflicts";
import { createJjDagRouter } from "./jj-dag";
import { createJjMutationsRouter } from "./jj-mutations";
import { createStagingRouter } from "./staging";
import { createStatusRouter } from "./status";

export const createChangesRouter = () => {
	const branchesRouter = createBranchesRouter();
	const statusRouter = createStatusRouter();
	const fileContentsRouter = createFileContentsRouter();
	const stagingRouter = createStagingRouter();
	const gitOperationsRouter = createGitOperationsRouter();
	const jjRouter = createJjRouter();
	const jjMutationsRouter = createJjMutationsRouter();
	const jjConflictsRouter = createJjConflictsRouter();
	const jjDagRouter = createJjDagRouter();

	return router({
		// Branch operations
		...branchesRouter._def.procedures,

		// Status operations
		...statusRouter._def.procedures,

		// File contents operations
		...fileContentsRouter._def.procedures,

		// Staging operations
		...stagingRouter._def.procedures,

		// Git operations (commit, push, pull, sync, createPR)
		...gitOperationsRouter._def.procedures,

		// Jj-native read-only queries
		...jjRouter._def.procedures,

		// Jj-native mutations (describe, commit, squash, edit, rebase, bookmarks)
		...jjMutationsRouter._def.procedures,

		// Jj conflict list / content / resolve
		...jjConflictsRouter._def.procedures,

		// Jj DAG query
		...jjDagRouter._def.procedures,
	});
};
