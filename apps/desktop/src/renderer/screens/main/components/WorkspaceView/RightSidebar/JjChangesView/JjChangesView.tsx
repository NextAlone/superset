import { Button } from "@superset/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	VscCheck,
	VscChevronRight,
	VscDiscard,
	VscRefresh,
	VscWarning,
} from "react-icons/vsc";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useChangesStore } from "renderer/stores/changes";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import type { ChangeCategory, ChangedFile } from "shared/changes-types";
import { FileList } from "../ChangesView/components/FileList";
import {
	BookmarkPromptDialog,
	type BookmarkPromptRequest,
} from "./components/BookmarkPromptDialog";
import { ConfirmDialog, type ConfirmRequest } from "./components/ConfirmDialog";
import { ConflictEditor } from "./components/ConflictEditor";
import { JjBaseBookmarkSelector } from "./components/JjBaseBookmarkSelector";
import { RevisionDag } from "./components/RevisionDag";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JjChangesViewProps {
	onFileOpen?: (
		file: ChangedFile,
		category: ChangeCategory,
		commitHash?: string,
	) => void;
	isExpandedView?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JjChangesView({
	onFileOpen,
	isExpandedView,
}: JjChangesViewProps) {
	const { workspaceId } = useParams({ strict: false });
	const { data: workspace } = electronTrpc.workspaces.get.useQuery(
		{ id: workspaceId ?? "" },
		{ enabled: !!workspaceId },
	);
	const worktreePath = workspace?.worktreePath;
	const projectId = workspace?.projectId;

	// ---- Local UI state ---------------------------------------------------
	const [description, setDescription] = useState("");
	const [sections, setSections] = useState({
		changes: true,
		againstBase: true,
		history: true,
	});

	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	const lastSyncedDesc = useRef("");

	// ---- Base bookmark (persisted via `changes.getBranches`) --------------
	const { data: branchData } = electronTrpc.changes.getBranches.useQuery(
		{ worktreePath: worktreePath ?? "" },
		{ enabled: !!worktreePath, staleTime: 10_000 },
	);
	const defaultBookmark = branchData?.defaultBranch ?? "main";
	const baseBookmark =
		branchData?.worktreeBaseBranch ?? defaultBookmark ?? "main";

	// ---- Store (file selection / view mode) --------------------------------
	const { fileListViewMode, selectFile, getSelectedFile } = useChangesStore();
	const selectedFileState = getSelectedFile(workspaceId || "");
	const selectedFile = selectedFileState?.file ?? null;
	const selectedCommitHash = selectedFileState?.commitHash ?? null;

	// ---- tRPC query --------------------------------------------------------
	const {
		data: changeStatus,
		isLoading,
		refetch,
	} = electronTrpc.changes.jjGetChangeStatus.useQuery(
		{ worktreePath: worktreePath ?? "", baseBookmark },
		{ enabled: !!worktreePath, refetchInterval: 2500 },
	);

	// ---- tRPC mutations ----------------------------------------------------
	const describeMutation = electronTrpc.changes.jjDescribe.useMutation({
		onSuccess: () => refetch(),
		onError: (err) => toast.error(`Describe failed: ${err.message}`),
	});

	const commitMutation = electronTrpc.changes.jjCommit.useMutation({
		onSuccess: () => {
			toast.success("Change committed");
			refetch();
		},
		onError: (err) => toast.error(`Commit failed: ${err.message}`),
	});

	const squashMutation = electronTrpc.changes.jjSquash.useMutation({
		onSuccess: () => {
			toast.success("Squashed into parent");
			refetch();
		},
		onError: (err) => toast.error(`Squash failed: ${err.message}`),
	});

	const discardFileMutation = electronTrpc.changes.jjDiscardFile.useMutation({
		onSuccess: () => refetch(),
		onError: (err) => toast.error(`Discard file failed: ${err.message}`),
	});

	const discardAllMutation = electronTrpc.changes.jjDiscardAll.useMutation({
		onSuccess: () => {
			toast.success("All changes discarded");
			refetch();
		},
		onError: (err) => toast.error(`Discard all failed: ${err.message}`),
	});

	const editMutation = electronTrpc.changes.jjEdit.useMutation({
		onSuccess: () => refetch(),
		onError: (err) => toast.error(`Edit failed: ${err.message}`),
	});

	// ---- Bookmark state + mutations ---------------------------------------
	const [bookmarkPrompt, setBookmarkPrompt] =
		useState<BookmarkPromptRequest | null>(null);
	const [pendingBookmarkTarget, setPendingBookmarkTarget] = useState<{
		changeId?: string;
		oldName?: string;
	}>({});

	const bookmarkCreateMutation =
		electronTrpc.changes.jjBookmarkCreate.useMutation({
			onSuccess: () => {
				toast.success("Bookmark created");
				setBookmarkPrompt(null);
				refetch();
			},
			onError: (err) => toast.error(`Create failed: ${err.message}`),
		});

	const bookmarkRenameMutation =
		electronTrpc.changes.jjBookmarkRename.useMutation({
			onSuccess: () => {
				toast.success("Bookmark renamed");
				setBookmarkPrompt(null);
				refetch();
			},
			onError: (err) => toast.error(`Rename failed: ${err.message}`),
		});

	const bookmarkDeleteMutation =
		electronTrpc.changes.jjBookmarkDelete.useMutation({
			onSuccess: () => {
				toast.success("Bookmark deleted");
				refetch();
			},
			onError: (err) => toast.error(`Delete failed: ${err.message}`),
		});

	const bookmarkMoveMutation = electronTrpc.changes.jjBookmarkMove.useMutation({
		onSuccess: () => {
			toast.success("Bookmark moved");
			refetch();
		},
		onError: (err) => toast.error(`Move failed: ${err.message}`),
	});

	// ---- History-rewriting mutations --------------------------------------
	const squashIntoMutation = electronTrpc.changes.jjSquashInto.useMutation({
		onSuccess: () => {
			toast.success("Squashed into target");
			refetch();
		},
		onError: (err) => toast.error(`Squash failed: ${err.message}`),
	});

	const rebaseMutation = electronTrpc.changes.jjRebase.useMutation({
		onSuccess: () => {
			toast.success("Rebased");
			refetch();
		},
		onError: (err) => toast.error(`Rebase failed: ${err.message}`),
	});

	// ---- Confirm dialog state ---------------------------------------------
	const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
		null,
	);

	// ---- Conflict editor state --------------------------------------------
	const [conflictEditorOpen, setConflictEditorOpen] = useState(false);
	const conflictListQuery = electronTrpc.changes.jjConflictList.useQuery(
		{ worktreePath: worktreePath ?? "" },
		{
			enabled: !!worktreePath && (changeStatus?.hasConflicts ?? false),
			refetchInterval: 3000,
		},
	);
	const conflictCount = conflictListQuery.data?.length ?? 0;

	// ---- DAG query ---------------------------------------------------------
	const dagQuery = electronTrpc.changes.jjGetDag.useQuery(
		{ worktreePath: worktreePath ?? "", baseBookmark },
		{ enabled: !!worktreePath, refetchInterval: 2500 },
	);

	// ---- Sync description from server → local state -----------------------
	useEffect(() => {
		if (changeStatus && changeStatus.description !== lastSyncedDesc.current) {
			setDescription(changeStatus.description);
			lastSyncedDesc.current = changeStatus.description;
		}
	}, [changeStatus]);

	// ---- Handlers ----------------------------------------------------------
	const handleDescriptionBlur = useCallback(() => {
		if (!worktreePath) return;
		const trimmed = description.trim();
		if (trimmed === lastSyncedDesc.current) return;
		lastSyncedDesc.current = trimmed;
		describeMutation.mutate({ worktreePath, message: trimmed });
	}, [description, worktreePath, describeMutation]);

	const handleCommit = useCallback(() => {
		if (!worktreePath) return;
		const msg = description.trim();
		if (!msg) {
			toast.error("Description is required to commit");
			descriptionRef.current?.focus();
			return;
		}
		commitMutation.mutate({ worktreePath, message: msg });
	}, [worktreePath, description, commitMutation]);

	const handleSquash = useCallback(() => {
		if (!worktreePath) return;
		squashMutation.mutate({
			worktreePath,
			message: description.trim() || undefined,
		});
	}, [worktreePath, description, squashMutation]);

	const handleDiscard = useCallback(
		(file: ChangedFile) => {
			if (!worktreePath) return;
			discardFileMutation.mutate({ worktreePath, filePath: file.path });
		},
		[worktreePath, discardFileMutation],
	);

	const handleDiscardAll = useCallback(() => {
		if (!worktreePath) return;
		discardAllMutation.mutate({ worktreePath });
	}, [worktreePath, discardAllMutation]);

	const handleEdit = useCallback(
		(changeId: string) => {
			if (!worktreePath) return;
			editMutation.mutate({ worktreePath, changeId });
		},
		[worktreePath, editMutation],
	);

	// ---- Bookmark handlers -------------------------------------------------
	const allBookmarks = useMemo(() => {
		const set = new Set<string>();
		if (changeStatus?.bookmark) set.add(changeStatus.bookmark);
		for (const r of changeStatus?.ancestors ?? []) {
			for (const b of r.bookmarks) set.add(b);
		}
		for (const n of dagQuery.data?.nodes ?? []) {
			for (const b of n.bookmarks) set.add(b);
		}
		return [...set].sort();
	}, [changeStatus, dagQuery.data]);

	const openCreateBookmarkPrompt = useCallback(
		(changeId: string) => {
			setPendingBookmarkTarget({ changeId });
			setBookmarkPrompt({
				mode: "create",
				disallowed: allBookmarks,
				context: changeId,
			});
		},
		[allBookmarks],
	);

	const openRenameBookmarkPrompt = useCallback(
		(name: string) => {
			setPendingBookmarkTarget({ oldName: name });
			setBookmarkPrompt({
				mode: "rename",
				initialValue: name,
				disallowed: allBookmarks,
			});
		},
		[allBookmarks],
	);

	const handleBookmarkPromptSubmit = useCallback(
		(name: string) => {
			if (!worktreePath) return;
			if (pendingBookmarkTarget.changeId) {
				bookmarkCreateMutation.mutate({
					worktreePath,
					name,
					revision: pendingBookmarkTarget.changeId,
				});
			} else if (pendingBookmarkTarget.oldName) {
				bookmarkRenameMutation.mutate({
					worktreePath,
					oldName: pendingBookmarkTarget.oldName,
					newName: name,
				});
			}
		},
		[
			worktreePath,
			pendingBookmarkTarget,
			bookmarkCreateMutation,
			bookmarkRenameMutation,
		],
	);

	const handleBookmarkDelete = useCallback(
		(name: string) => {
			if (!worktreePath) return;
			setConfirmRequest({
				title: `Delete bookmark "${name}"?`,
				description:
					"Forgets the local bookmark. A pushed copy on the remote will remain until deleted there.",
				confirmLabel: "Delete",
				destructive: true,
				onConfirm: () => {
					bookmarkDeleteMutation.mutate({ worktreePath, name });
					setConfirmRequest(null);
				},
			});
		},
		[worktreePath, bookmarkDeleteMutation],
	);

	const handleBookmarkMove = useCallback(
		(name: string, changeId: string) => {
			if (!worktreePath) return;
			bookmarkMoveMutation.mutate({ worktreePath, name, revision: changeId });
		},
		[worktreePath, bookmarkMoveMutation],
	);

	const handleSquashInto = useCallback(
		(changeId: string) => {
			if (!worktreePath || !changeStatus) return;
			const currentDesc = description.trim();
			setConfirmRequest({
				title: "Squash @ into this change?",
				description: (
					<>
						Current change{" "}
						<span className="font-mono text-foreground">
							{changeStatus.changeId}
						</span>{" "}
						will be merged into{" "}
						<span className="font-mono text-foreground">{changeId}</span>. This
						rewrites history.
					</>
				),
				confirmLabel: "Squash",
				destructive: true,
				onConfirm: () => {
					squashIntoMutation.mutate({
						worktreePath,
						targetChangeId: changeId,
						message: currentDesc || undefined,
					});
					setConfirmRequest(null);
				},
			});
		},
		[worktreePath, changeStatus, description, squashIntoMutation],
	);

	const handleRebaseOnto = useCallback(
		(changeId: string) => {
			if (!worktreePath) return;
			setConfirmRequest({
				title: "Rebase onto this change?",
				description: (
					<>
						The current branch (from @) will be rebased onto{" "}
						<span className="font-mono text-foreground">{changeId}</span>. This
						rewrites history.
					</>
				),
				confirmLabel: "Rebase",
				destructive: true,
				onConfirm: () => {
					rebaseMutation.mutate({ worktreePath, destination: changeId });
					setConfirmRequest(null);
				},
			});
		},
		[worktreePath, rebaseMutation],
	);

	const handleFileSelect = useCallback(
		(file: ChangedFile, category: ChangeCategory) => {
			if (!workspaceId || !worktreePath) return;
			selectFile(
				workspaceId,
				toAbsoluteWorkspacePath(worktreePath, file.path),
				file,
				category,
				null,
			);
			onFileOpen?.(file, category);
		},
		[workspaceId, worktreePath, selectFile, onFileOpen],
	);

	const toggleSection = useCallback(
		(key: keyof typeof sections) =>
			setSections((prev) => ({ ...prev, [key]: !prev[key] })),
		[],
	);

	// ---- Early returns -----------------------------------------------------
	if (!worktreePath) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
				No workspace selected
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
				Loading changes...
			</div>
		);
	}

	if (!changeStatus) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
				Unable to load jj status
			</div>
		);
	}

	const filesCount = changeStatus.files.length;
	const againstBaseCount = changeStatus.againstBase.length;
	const dagNodesCount = dagQuery.data?.nodes.length ?? 0;
	const hasChanges =
		filesCount > 0 || againstBaseCount > 0 || dagNodesCount > 0;

	// ---- Render ------------------------------------------------------------
	return (
		<div className="flex flex-col flex-1 min-h-0">
			{/* Header */}
			<div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-6"
							onClick={() => refetch()}
						>
							<VscRefresh className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">Refresh</TooltipContent>
				</Tooltip>

				<span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
					Base:
					<JjBaseBookmarkSelector
						worktreePath={worktreePath}
						effectiveBaseBookmark={changeStatus.baseBookmark}
						defaultBookmark={defaultBookmark}
					/>
				</span>

				{changeStatus.hasConflicts && (
					<Tooltip>
						<TooltipTrigger asChild>
							<span>
								<VscWarning className="size-3.5 text-yellow-500" />
							</span>
						</TooltipTrigger>
						<TooltipContent side="bottom">Change has conflicts</TooltipContent>
					</Tooltip>
				)}

				<span className="flex-1" />

				{changeStatus.bookmark && (
					<span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground font-mono">
						{changeStatus.bookmark}
					</span>
				)}
			</div>

			{/* Change ID + Description */}
			<div className="px-2 py-2 border-b border-border space-y-1.5 shrink-0">
				<div className="flex items-center gap-1.5">
					<span className="text-xs font-medium">Change:</span>
					<span className="text-xs font-mono text-muted-foreground">
						{changeStatus.changeId}
					</span>
				</div>

				<textarea
					ref={descriptionRef}
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					onBlur={handleDescriptionBlur}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							handleDescriptionBlur();
						}
					}}
					placeholder="Description..."
					rows={2}
					className={cn(
						"w-full resize-none rounded border border-border bg-background px-2 py-1.5",
						"text-xs focus:outline-none focus:ring-1 focus:ring-ring",
					)}
				/>

				<div className="flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-xs"
						disabled={commitMutation.isPending || !description.trim()}
						onClick={handleCommit}
					>
						<VscCheck className="size-3 mr-1" />
						Commit
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-xs"
						disabled={squashMutation.isPending}
						onClick={handleSquash}
					>
						Squash
					</Button>
				</div>
			</div>

			{/* Conflict warning bar */}
			{changeStatus.hasConflicts && (
				<div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-yellow-500/10 shrink-0">
					<VscWarning className="size-3.5 text-yellow-500 shrink-0" />
					<span className="text-[11px] flex-1 min-w-0 truncate">
						{conflictCount > 0
							? `${conflictCount} file${conflictCount === 1 ? "" : "s"} have conflicts`
							: "Change has conflicts"}
					</span>
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-[11px] px-2"
						onClick={() => setConflictEditorOpen(true)}
					>
						Resolve…
					</Button>
				</div>
			)}

			{/* Content */}
			{!hasChanges ? (
				<div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
					No changes detected
				</div>
			) : (
				<div className="flex-1 overflow-y-auto" data-changes-scroll-container>
					{/* Working copy changes */}
					{filesCount > 0 && (
						<Collapsible
							open={sections.changes}
							onOpenChange={() => toggleSection("changes")}
							className="min-w-0"
						>
							<div className="group flex items-center min-w-0">
								<CollapsibleTrigger
									className={cn(
										"flex-1 flex items-center gap-1.5 px-2 py-1.5 text-left min-w-0",
										"hover:bg-accent/30 cursor-pointer transition-colors",
									)}
								>
									<VscChevronRight
										className={cn(
											"size-3 text-muted-foreground shrink-0 transition-transform duration-150",
											sections.changes && "rotate-90",
										)}
									/>
									<span className="text-xs font-medium truncate">Changes</span>
									<span className="text-[10px] text-muted-foreground shrink-0">
										{filesCount}
									</span>
								</CollapsibleTrigger>
								<div className="pr-1.5 shrink-0">
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="icon"
												className="size-5"
												disabled={discardAllMutation.isPending}
												onClick={handleDiscardAll}
											>
												<VscDiscard className="size-3" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											Discard all changes
										</TooltipContent>
									</Tooltip>
								</div>
							</div>
							<CollapsibleContent className="px-0.5 pb-1 min-w-0 overflow-hidden">
								<FileList
									files={changeStatus.files}
									viewMode={fileListViewMode}
									selectedFile={selectedFile}
									selectedCommitHash={selectedCommitHash}
									onFileSelect={(file) => handleFileSelect(file, "unstaged")}
									onDiscard={handleDiscard}
									worktreePath={worktreePath}
									category="unstaged"
									isExpandedView={isExpandedView}
									projectId={projectId}
								/>
							</CollapsibleContent>
						</Collapsible>
					)}

					{/* Against base */}
					{againstBaseCount > 0 && (
						<Collapsible
							open={sections.againstBase}
							onOpenChange={() => toggleSection("againstBase")}
							className="min-w-0"
						>
							<CollapsibleTrigger
								className={cn(
									"w-full flex items-center gap-1.5 px-2 py-1.5 text-left min-w-0",
									"hover:bg-accent/30 cursor-pointer transition-colors",
								)}
							>
								<VscChevronRight
									className={cn(
										"size-3 text-muted-foreground shrink-0 transition-transform duration-150",
										sections.againstBase && "rotate-90",
									)}
								/>
								<span className="text-xs font-medium truncate">
									Against Base: {changeStatus.baseBookmark}
								</span>
								<span className="text-[10px] text-muted-foreground shrink-0">
									{againstBaseCount}
								</span>
								{changeStatus.ahead > 0 && (
									<span className="text-[10px] text-muted-foreground shrink-0">
										({changeStatus.ahead} ahead)
									</span>
								)}
							</CollapsibleTrigger>
							<CollapsibleContent className="px-0.5 pb-1 min-w-0 overflow-hidden">
								<FileList
									files={changeStatus.againstBase}
									viewMode={fileListViewMode}
									selectedFile={selectedFile}
									selectedCommitHash={selectedCommitHash}
									onFileSelect={(file) =>
										handleFileSelect(file, "against-base")
									}
									worktreePath={worktreePath}
									category="against-base"
									isExpandedView={isExpandedView}
									projectId={projectId}
								/>
							</CollapsibleContent>
						</Collapsible>
					)}

					{/* Revision Graph (DAG) */}
					{dagNodesCount > 0 && (
						<Collapsible
							open={sections.history}
							onOpenChange={() => toggleSection("history")}
							className="min-w-0"
						>
							<CollapsibleTrigger
								className={cn(
									"w-full flex items-center gap-1.5 px-2 py-1.5 text-left min-w-0",
									"hover:bg-accent/30 cursor-pointer transition-colors",
								)}
							>
								<VscChevronRight
									className={cn(
										"size-3 text-muted-foreground shrink-0 transition-transform duration-150",
										sections.history && "rotate-90",
									)}
								/>
								<span className="text-xs font-medium truncate">
									Revision Graph
								</span>
								<span className="text-[10px] text-muted-foreground shrink-0">
									{dagNodesCount}
								</span>
							</CollapsibleTrigger>
							<CollapsibleContent className="px-0.5 pb-1 min-w-0 overflow-hidden">
								<RevisionDag
									nodes={dagQuery.data?.nodes ?? []}
									truncated={dagQuery.data?.truncated ?? false}
									isEditPending={editMutation.isPending}
									availableBookmarks={allBookmarks}
									onEdit={handleEdit}
									onSquashInto={handleSquashInto}
									onRebaseOnto={handleRebaseOnto}
									onBookmarkCreate={openCreateBookmarkPrompt}
									onBookmarkMove={handleBookmarkMove}
									onBookmarkRename={openRenameBookmarkPrompt}
									onBookmarkDelete={handleBookmarkDelete}
								/>
							</CollapsibleContent>
						</Collapsible>
					)}
				</div>
			)}
			<BookmarkPromptDialog
				request={bookmarkPrompt}
				onCancel={() => setBookmarkPrompt(null)}
				onSubmit={handleBookmarkPromptSubmit}
				isPending={
					bookmarkCreateMutation.isPending || bookmarkRenameMutation.isPending
				}
			/>
			<ConfirmDialog
				request={confirmRequest}
				onCancel={() => setConfirmRequest(null)}
				isPending={
					bookmarkDeleteMutation.isPending ||
					bookmarkMoveMutation.isPending ||
					squashIntoMutation.isPending ||
					rebaseMutation.isPending
				}
			/>
			<ConflictEditor
				worktreePath={worktreePath}
				open={conflictEditorOpen}
				onOpenChange={setConflictEditorOpen}
				onResolved={() => {
					conflictListQuery.refetch();
					refetch();
				}}
			/>
		</div>
	);
}
