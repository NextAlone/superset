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
import { useCallback, useEffect, useRef, useState } from "react";
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
import { JjBaseBookmarkSelector } from "./components/JjBaseBookmarkSelector";
import { RevisionRow } from "./components/RevisionRow";

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
	const ancestorsCount = changeStatus.ancestors.length;
	const hasChanges =
		filesCount > 0 || againstBaseCount > 0 || ancestorsCount > 0;

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

					{/* History (ancestors) */}
					{ancestorsCount > 0 && (
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
								<span className="text-xs font-medium truncate">History</span>
								<span className="text-[10px] text-muted-foreground shrink-0">
									{ancestorsCount}
								</span>
							</CollapsibleTrigger>
							<CollapsibleContent className="px-0.5 pb-1 min-w-0 overflow-hidden">
								<div className="space-y-0.5">
									{changeStatus.ancestors.map((rev) => (
										<RevisionRow
											key={rev.commitId}
											revision={rev}
											isCurrent={rev.changeId === changeStatus.changeId}
											isEditPending={editMutation.isPending}
											onEdit={handleEdit}
										/>
									))}
								</div>
							</CollapsibleContent>
						</Collapsible>
					)}
				</div>
			)}
		</div>
	);
}
