import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { VscBookmark, VscEdit, VscTrash } from "react-icons/vsc";
import { layoutDag } from "./dag-layout";
import type { DagNode } from "./types";

interface RevisionDagProps {
	nodes: DagNode[];
	truncated: boolean;
	isEditPending?: boolean;
	availableBookmarks?: string[];
	onEdit?: (changeId: string) => void;
	onSquashInto?: (changeId: string) => void;
	onRebaseOnto?: (changeId: string) => void;
	onBookmarkCreate?: (changeId: string) => void;
	onBookmarkMove?: (bookmarkName: string, changeId: string) => void;
	onBookmarkRename?: (name: string) => void;
	onBookmarkDelete?: (name: string) => void;
}

const ROW_HEIGHT = 28;
const LANE_WIDTH = 14;
const NODE_RADIUS = 4;
const LANE_COLORS = [
	"text-blue-500",
	"text-green-500",
	"text-orange-500",
	"text-pink-500",
	"text-purple-500",
	"text-cyan-500",
	"text-yellow-500",
	"text-red-500",
];

export function RevisionDag({
	nodes,
	truncated,
	isEditPending = false,
	availableBookmarks = [],
	onEdit,
	onSquashInto,
	onRebaseOnto,
	onBookmarkCreate,
	onBookmarkMove,
	onBookmarkRename,
	onBookmarkDelete,
}: RevisionDagProps) {
	const layout = useMemo(() => layoutDag(nodes), [nodes]);

	if (layout.rows.length === 0) {
		return (
			<div className="px-2 py-3 text-xs text-muted-foreground">
				No revisions in range
			</div>
		);
	}

	const svgWidth = Math.max(
		layout.laneCount * LANE_WIDTH + LANE_WIDTH,
		LANE_WIDTH * 2,
	);
	const svgHeight = layout.rows.length * ROW_HEIGHT;

	return (
		<div className="relative min-w-0" style={{ paddingLeft: svgWidth }}>
			{/* Lane / edge SVG overlay */}
			<svg
				className="absolute left-0 top-0 pointer-events-none"
				width={svgWidth}
				height={svgHeight}
				viewBox={`0 0 ${svgWidth} ${svgHeight}`}
				role="img"
				aria-label="Revision graph"
			>
				<title>Revision graph</title>
				{layout.edges.map((edge, i) => {
					const x1 = laneX(edge.fromLane);
					const y1 = rowY(edge.fromRow);
					const x2 = laneX(edge.toLane);
					const y2 = edge.outOfRange ? svgHeight : rowY(edge.toRow);
					const colorClass =
						LANE_COLORS[edge.fromLane % LANE_COLORS.length] ??
						"text-muted-foreground";
					const path =
						edge.fromLane === edge.toLane
							? `M ${x1} ${y1} L ${x2} ${y2}`
							: `M ${x1} ${y1} C ${x1} ${y1 + ROW_HEIGHT / 2}, ${x2} ${y2 - ROW_HEIGHT / 2}, ${x2} ${y2}`;
					return (
						<path
							// biome-ignore lint/suspicious/noArrayIndexKey: edges are stable by input order
							key={i}
							d={path}
							className={cn(
								colorClass,
								"stroke-current opacity-60",
								edge.outOfRange && "opacity-30",
							)}
							strokeWidth={1.5}
							fill="none"
							strokeDasharray={edge.outOfRange ? "3 3" : undefined}
						/>
					);
				})}
				{layout.rows.map((row) => {
					const cx = laneX(row.lane);
					const cy = rowY(
						layout.rows.findIndex((r) => r.node.changeId === row.node.changeId),
					);
					const colorClass =
						LANE_COLORS[row.lane % LANE_COLORS.length] ??
						"text-muted-foreground";
					if (row.node.isWorkingCopy) {
						return (
							<circle
								key={row.node.changeId}
								cx={cx}
								cy={cy}
								r={NODE_RADIUS + 1}
								className="fill-blue-500 stroke-blue-600"
								strokeWidth={1}
							/>
						);
					}
					if (row.node.hasConflicts) {
						return (
							<circle
								key={row.node.changeId}
								cx={cx}
								cy={cy}
								r={NODE_RADIUS}
								className="fill-yellow-500 stroke-yellow-600"
								strokeWidth={1}
							/>
						);
					}
					if (row.node.isEmpty) {
						return (
							<circle
								key={row.node.changeId}
								cx={cx}
								cy={cy}
								r={NODE_RADIUS}
								className={cn(colorClass, "fill-background stroke-current")}
								strokeWidth={1.5}
							/>
						);
					}
					return (
						<circle
							key={row.node.changeId}
							cx={cx}
							cy={cy}
							r={NODE_RADIUS}
							className={cn(colorClass, "fill-current")}
						/>
					);
				})}
			</svg>

			{/* Text rows */}
			<div>
				{layout.rows.map((row) => (
					<DagNodeRow
						key={row.node.changeId}
						node={row.node}
						isEditPending={isEditPending}
						availableBookmarks={availableBookmarks}
						onEdit={onEdit}
						onSquashInto={onSquashInto}
						onRebaseOnto={onRebaseOnto}
						onBookmarkCreate={onBookmarkCreate}
						onBookmarkMove={onBookmarkMove}
						onBookmarkRename={onBookmarkRename}
						onBookmarkDelete={onBookmarkDelete}
					/>
				))}
				{truncated && (
					<div className="text-[11px] px-1.5 py-1 text-muted-foreground">
						Showing first 50 revisions — more hidden
					</div>
				)}
			</div>
		</div>
	);
}

function laneX(lane: number): number {
	return LANE_WIDTH / 2 + lane * LANE_WIDTH;
}

function rowY(row: number): number {
	return ROW_HEIGHT / 2 + row * ROW_HEIGHT;
}

interface DagNodeRowProps {
	node: DagNode;
	isEditPending: boolean;
	availableBookmarks: string[];
	onEdit?: (changeId: string) => void;
	onSquashInto?: (changeId: string) => void;
	onRebaseOnto?: (changeId: string) => void;
	onBookmarkCreate?: (changeId: string) => void;
	onBookmarkMove?: (bookmarkName: string, changeId: string) => void;
	onBookmarkRename?: (name: string) => void;
	onBookmarkDelete?: (name: string) => void;
}

function DagNodeRow({
	node,
	isEditPending,
	availableBookmarks,
	onEdit,
	onSquashInto,
	onRebaseOnto,
	onBookmarkCreate,
	onBookmarkMove,
	onBookmarkRename,
	onBookmarkDelete,
}: DagNodeRowProps) {
	const moveCandidates = availableBookmarks.filter(
		(b) => !node.bookmarks.includes(b),
	);

	const handleEdit = () => {
		if (node.isWorkingCopy || isEditPending) return;
		onEdit?.(node.changeId);
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className={cn(
						"flex items-center gap-1.5 pl-1 pr-1.5 text-xs rounded-sm min-w-0 hover:bg-accent/30 cursor-default",
						node.isWorkingCopy && "bg-accent/40",
					)}
					style={{ height: ROW_HEIGHT }}
				>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="font-mono shrink-0 text-muted-foreground">
								{node.changeId}
							</span>
						</TooltipTrigger>
						<TooltipContent side="left">
							<div className="font-mono text-[10px]">{node.shortCommitId}</div>
							<div>{node.author}</div>
							<div className="text-muted-foreground">{node.timestamp}</div>
						</TooltipContent>
					</Tooltip>

					<span className="truncate flex-1 min-w-0">
						{node.description || (
							<span className="text-muted-foreground/60 italic">
								(no description)
							</span>
						)}
					</span>

					{node.bookmarks.map((name) => (
						<BookmarkBadge
							key={name}
							name={name}
							onRename={onBookmarkRename}
							onDelete={onBookmarkDelete}
						/>
					))}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-52">
				<ContextMenuItem
					disabled={node.isWorkingCopy || isEditPending}
					onSelect={handleEdit}
				>
					<VscEdit className="size-3.5 mr-2" />
					Edit this change
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					disabled={node.isWorkingCopy || !onSquashInto}
					onSelect={() => onSquashInto?.(node.changeId)}
				>
					Squash @ into this change
				</ContextMenuItem>
				<ContextMenuItem
					disabled={!onRebaseOnto}
					onSelect={() => onRebaseOnto?.(node.changeId)}
				>
					Rebase @ onto this change
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					disabled={!onBookmarkCreate}
					onSelect={() => onBookmarkCreate?.(node.changeId)}
				>
					<VscBookmark className="size-3.5 mr-2" />
					Create bookmark here…
				</ContextMenuItem>
				{moveCandidates.length > 0 && onBookmarkMove ? (
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<VscBookmark className="size-3.5 mr-2" />
							Move bookmark here
						</ContextMenuSubTrigger>
						<ContextMenuSubContent className="max-h-64 overflow-y-auto">
							{moveCandidates.map((name) => (
								<ContextMenuItem
									key={name}
									onSelect={() => onBookmarkMove(name, node.changeId)}
								>
									{name}
								</ContextMenuItem>
							))}
						</ContextMenuSubContent>
					</ContextMenuSub>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}

interface BookmarkBadgeProps {
	name: string;
	onRename?: (name: string) => void;
	onDelete?: (name: string) => void;
}

function BookmarkBadge({ name, onRename, onDelete }: BookmarkBadgeProps) {
	const badge = (
		<span className="text-[10px] px-1 rounded bg-accent text-accent-foreground font-mono shrink-0">
			{name}
		</span>
	);
	if (!onRename && !onDelete) return badge;
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{badge}</ContextMenuTrigger>
			<ContextMenuContent className="w-44">
				{onRename ? (
					<ContextMenuItem onSelect={() => onRename(name)}>
						<VscEdit className="size-3.5 mr-2" />
						Rename bookmark…
					</ContextMenuItem>
				) : null}
				{onDelete ? (
					<ContextMenuItem
						className="text-destructive focus:text-destructive"
						onSelect={() => onDelete(name)}
					>
						<VscTrash className="size-3.5 mr-2" />
						Delete bookmark
					</ContextMenuItem>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}
