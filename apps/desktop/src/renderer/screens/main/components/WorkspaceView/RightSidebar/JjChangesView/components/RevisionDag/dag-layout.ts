import type { DagNode } from "./types";

export interface DagRow {
	node: DagNode;
	lane: number;
}

export interface DagEdge {
	fromRow: number;
	fromLane: number;
	toRow: number;
	toLane: number;
	outOfRange: boolean;
}

export interface DagLayout {
	rows: DagRow[];
	edges: DagEdge[];
	laneCount: number;
}

// Greedy lane assignment. Input nodes are topologically sorted, newest first.
// The first parent inherits the current lane; additional parents take the
// next free lane (reusing slots that have been vacated). This produces
// roughly-straight lines for linear histories with occasional bumps for
// merges or diverged heads.
export function layoutDag(nodes: DagNode[]): DagLayout {
	const nodeSet = new Set(nodes.map((n) => n.changeId));
	const laneOf = new Map<string, number>();
	const activeLanes: (string | null)[] = [];

	function claimLane(changeId: string): number {
		const existing = laneOf.get(changeId);
		if (existing !== undefined) return existing;
		const free = activeLanes.indexOf(null);
		const lane = free === -1 ? activeLanes.length : free;
		if (free === -1) activeLanes.push(changeId);
		else activeLanes[free] = changeId;
		laneOf.set(changeId, lane);
		return lane;
	}

	const rows: DagRow[] = [];

	for (const node of nodes) {
		const lane = claimLane(node.changeId);
		rows.push({ node, lane });

		// Our lane is free below us until we decide whether a parent inherits it
		activeLanes[lane] = null;

		let first = true;
		for (const parent of node.parentChangeIds) {
			if (!nodeSet.has(parent)) continue;
			if (laneOf.has(parent)) {
				first = false;
				continue;
			}
			if (first && activeLanes[lane] === null) {
				activeLanes[lane] = parent;
				laneOf.set(parent, lane);
			} else {
				const free = activeLanes.indexOf(null);
				const newLane = free === -1 ? activeLanes.length : free;
				if (free === -1) activeLanes.push(parent);
				else activeLanes[free] = parent;
				laneOf.set(parent, newLane);
			}
			first = false;
		}

		// Compact trailing nulls to keep laneCount tight
		while (
			activeLanes.length > 0 &&
			activeLanes[activeLanes.length - 1] === null
		) {
			activeLanes.pop();
		}
	}

	// Build edges
	const rowIndex = new Map<string, number>();
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i];
		if (row) rowIndex.set(row.node.changeId, i);
	}

	const edges: DagEdge[] = [];
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i];
		if (!row) continue;
		for (const parent of row.node.parentChangeIds) {
			const parentRow = rowIndex.get(parent);
			if (parentRow === undefined) {
				edges.push({
					fromRow: i,
					fromLane: row.lane,
					toRow: rows.length,
					toLane: row.lane,
					outOfRange: true,
				});
				continue;
			}
			const parentLane = rows[parentRow]?.lane ?? row.lane;
			edges.push({
				fromRow: i,
				fromLane: row.lane,
				toRow: parentRow,
				toLane: parentLane,
				outOfRange: false,
			});
		}
	}

	const laneCount = rows.reduce((max, r) => Math.max(max, r.lane + 1), 1);

	return { rows, edges, laneCount };
}
