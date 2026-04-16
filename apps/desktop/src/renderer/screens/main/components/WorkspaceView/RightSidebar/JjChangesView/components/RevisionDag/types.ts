// Mirror of the main-process DagNode shape for renderer use.
// Source of truth: src/lib/trpc/routers/changes/jj-dag.ts
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
