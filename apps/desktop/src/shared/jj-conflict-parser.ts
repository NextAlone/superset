export interface ConflictRegion {
	base: string;
	left: string;
	right: string;
}

// Parses jj's diff3-style conflict markers. Example:
//   <<<<<<< Conflict 1 of N
//   +++++++ Contents of side #1
//   <left content>
//   ------- Contents of base
//   <base content>
//   +++++++ Contents of side #2
//   <right content>
//   >>>>>>> Conflict 1 of N ends
// Non-conflict regions are ignored; only the regions are returned.
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
			const buffers: { side1: string[]; base: string[]; side2: string[] } = {
				side1: [],
				base: [],
				side2: [],
			};
			let current: "side1" | "base" | "side2" | null = null;
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

export function hasUnresolvedConflictMarkers(content: string): boolean {
	for (const line of content.split("\n")) {
		if (line.startsWith("<<<<<<<") || line.startsWith(">>>>>>>")) return true;
	}
	return false;
}
