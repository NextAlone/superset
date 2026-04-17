import { describe, expect, test } from "bun:test";
import {
	hasUnresolvedConflictMarkers,
	parseJjConflictMarkers,
} from "./jj-conflict-parser";

describe("parseJjConflictMarkers", () => {
	test("returns empty on content with no conflicts", () => {
		expect(parseJjConflictMarkers("hello\nworld\n")).toEqual([]);
	});

	test("parses a single diff3-style region", () => {
		const content = [
			"preamble",
			"<<<<<<< Conflict 1 of 1",
			"+++++++ Contents of side #1",
			"left-line-1",
			"left-line-2",
			"------- Contents of base",
			"base-line",
			"+++++++ Contents of side #2",
			"right-line",
			">>>>>>> Conflict 1 of 1 ends",
			"postamble",
		].join("\n");

		expect(parseJjConflictMarkers(content)).toEqual([
			{
				left: "left-line-1\nleft-line-2",
				base: "base-line",
				right: "right-line",
			},
		]);
	});

	test("parses multiple conflict regions in a single file", () => {
		const content = [
			"<<<<<<< 1",
			"+++++++ side #1",
			"L1",
			"------- base",
			"B1",
			"+++++++ side #2",
			"R1",
			">>>>>>>",
			"middle",
			"<<<<<<< 2",
			"+++++++ side #1",
			"L2",
			"------- base",
			"B2",
			"+++++++ side #2",
			"R2",
			">>>>>>>",
		].join("\n");

		const regions = parseJjConflictMarkers(content);
		expect(regions).toHaveLength(2);
		expect(regions[0]).toEqual({ left: "L1", base: "B1", right: "R1" });
		expect(regions[1]).toEqual({ left: "L2", base: "B2", right: "R2" });
	});

	test("handles empty side / base contents", () => {
		const content = [
			"<<<<<<<",
			"+++++++ side #1",
			"------- base",
			"base",
			"+++++++ side #2",
			"right",
			">>>>>>>",
		].join("\n");

		expect(parseJjConflictMarkers(content)).toEqual([
			{ left: "", base: "base", right: "right" },
		]);
	});

	test("survives an unterminated region without throwing", () => {
		// If jj ever writes a partial marker, we should not loop forever.
		const content = "<<<<<<<\n+++++++ side #1\nL1\n";
		expect(() => parseJjConflictMarkers(content)).not.toThrow();
	});
});

describe("hasUnresolvedConflictMarkers", () => {
	test("returns true when markers are present", () => {
		expect(hasUnresolvedConflictMarkers("clean\n<<<<<<<\nfoo\n>>>>>>>\n")).toBe(
			true,
		);
	});

	test("returns false for clean content", () => {
		expect(hasUnresolvedConflictMarkers("abc\ndef\n")).toBe(false);
	});
});
