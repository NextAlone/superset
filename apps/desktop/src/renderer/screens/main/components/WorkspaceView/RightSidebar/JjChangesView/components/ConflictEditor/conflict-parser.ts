export interface ConflictRegion {
	base: string;
	left: string;
	right: string;
}

// Mirror of parseJjConflictMarkers in jj-conflicts.ts so the renderer can
// reason about markers locally while typing without round-tripping to main.
export function parseJjConflictMarkers(content: string): ConflictRegion[] {
	const regions: ConflictRegion[] = [];
	const lines = content.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (line.startsWith("<<<<<<<")) {
			let end = i + 1;
			while (end < lines.length && !(lines[end] ?? "").startsWith(">>>>>>>")) {
				end += 1;
			}
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

export function hasUnresolvedMarkers(content: string): boolean {
	for (const line of content.split("\n")) {
		if (line.startsWith("<<<<<<<") || line.startsWith(">>>>>>>")) return true;
	}
	return false;
}
