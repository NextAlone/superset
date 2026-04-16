import { Button } from "@superset/ui/button";
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
import {
	VscBookmark,
	VscCircleFilled,
	VscCircleLargeFilled,
	VscEdit,
	VscGitPullRequestGoToChanges,
	VscTrash,
	VscWarning,
} from "react-icons/vsc";

export interface RevisionRowData {
	changeId: string;
	commitId: string;
	description: string;
	bookmarks: string[];
	isEmpty: boolean;
	hasConflicts?: boolean;
}

interface RevisionRowProps {
	revision: RevisionRowData;
	isCurrent: boolean;
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

export function RevisionRow({
	revision,
	isCurrent,
	isEditPending = false,
	availableBookmarks = [],
	onEdit,
	onSquashInto,
	onRebaseOnto,
	onBookmarkCreate,
	onBookmarkMove,
	onBookmarkRename,
	onBookmarkDelete,
}: RevisionRowProps) {
	const handleEdit = () => {
		if (isCurrent || isEditPending) return;
		onEdit?.(revision.changeId);
	};

	const moveCandidates = availableBookmarks.filter(
		(b) => !revision.bookmarks.includes(b),
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className={cn(
						"group flex items-center gap-1.5 px-1.5 py-1 text-xs rounded-sm min-w-0",
						"hover:bg-accent/30 transition-colors",
						isCurrent && "bg-accent/40",
					)}
				>
					{revision.hasConflicts ? (
						<VscWarning className="size-2.5 shrink-0 text-yellow-500" />
					) : isCurrent ? (
						<VscCircleLargeFilled className="size-2.5 shrink-0 text-blue-500" />
					) : (
						<VscCircleFilled
							className={cn(
								"size-2.5 shrink-0",
								revision.isEmpty
									? "text-muted-foreground/40"
									: "text-muted-foreground",
							)}
						/>
					)}

					<span
						className={cn(
							"font-mono shrink-0",
							isCurrent ? "text-foreground" : "text-muted-foreground",
						)}
					>
						{revision.changeId}
					</span>

					<span className="truncate flex-1 min-w-0">
						{revision.description || (
							<span className="text-muted-foreground/60 italic">
								(no description)
							</span>
						)}
					</span>

					{revision.bookmarks.map((bookmark) => (
						<BookmarkBadge
							key={bookmark}
							name={bookmark}
							onRename={onBookmarkRename}
							onDelete={onBookmarkDelete}
						/>
					))}

					<div className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
						<Tooltip>
							<TooltipTrigger asChild>
								<span>
									<Button
										variant="ghost"
										size="icon"
										className="size-5"
										disabled={isCurrent || isEditPending}
										onClick={handleEdit}
									>
										<VscEdit className="size-3" />
									</Button>
								</span>
							</TooltipTrigger>
							<TooltipContent side="left">
								{isCurrent ? "Current change" : "Edit this change"}
							</TooltipContent>
						</Tooltip>
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-52">
				<ContextMenuItem
					disabled={isCurrent || isEditPending}
					onSelect={handleEdit}
				>
					<VscEdit className="size-3.5 mr-2" />
					Edit this change
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					disabled={isCurrent || !onSquashInto}
					onSelect={() => onSquashInto?.(revision.changeId)}
				>
					<VscGitPullRequestGoToChanges className="size-3.5 mr-2" />
					Squash @ into this change
				</ContextMenuItem>
				<ContextMenuItem
					disabled={!onRebaseOnto}
					onSelect={() => onRebaseOnto?.(revision.changeId)}
				>
					Rebase @ onto this change
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					disabled={!onBookmarkCreate}
					onSelect={() => onBookmarkCreate?.(revision.changeId)}
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
									onSelect={() => onBookmarkMove(name, revision.changeId)}
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
