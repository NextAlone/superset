import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { VscWarning } from "react-icons/vsc";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	hasUnresolvedConflictMarkers,
	parseJjConflictMarkers,
} from "shared/jj-conflict-parser";

interface ConflictEditorProps {
	worktreePath: string;
	open: boolean;
	initialFilePath?: string | null;
	onOpenChange: (open: boolean) => void;
	onResolved?: () => void;
}

export function ConflictEditor({
	worktreePath,
	open,
	initialFilePath = null,
	onOpenChange,
	onResolved,
}: ConflictEditorProps) {
	const listQuery = electronTrpc.changes.jjConflictList.useQuery(
		{ worktreePath },
		{ enabled: open && !!worktreePath },
	);

	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	useEffect(() => {
		if (!open) return;
		if (initialFilePath) {
			setSelectedPath(initialFilePath);
			return;
		}
		const list = listQuery.data ?? [];
		if (!selectedPath && list.length > 0) {
			setSelectedPath(list[0].path);
		} else if (selectedPath && !list.some((f) => f.path === selectedPath)) {
			setSelectedPath(list[0]?.path ?? null);
		}
	}, [open, initialFilePath, listQuery.data, selectedPath]);

	const contentQuery = electronTrpc.changes.jjConflictContent.useQuery(
		{ worktreePath, filePath: selectedPath ?? "" },
		{ enabled: open && !!worktreePath && !!selectedPath },
	);

	const [editor, setEditor] = useState("");
	useEffect(() => {
		if (contentQuery.data) setEditor(contentQuery.data.raw);
	}, [contentQuery.data]);

	const resolveMutation = electronTrpc.changes.jjConflictResolve.useMutation({
		onSuccess: () => {
			toast.success("Conflict saved");
			listQuery.refetch();
			onResolved?.();
		},
		onError: (err) => toast.error(`Resolve failed: ${err.message}`),
	});

	const regions = useMemo(() => parseJjConflictMarkers(editor), [editor]);
	const dirty = contentQuery.data ? editor !== contentQuery.data.raw : false;
	const unresolved = hasUnresolvedConflictMarkers(editor);

	const handleSave = () => {
		if (!selectedPath) return;
		resolveMutation.mutate({
			worktreePath,
			filePath: selectedPath,
			resolvedContent: editor,
		});
	};

	// "Use" helpers replace the first unresolved region with the chosen side.
	const applySide = (side: "left" | "right" | "base") => {
		const lines = editor.split("\n");
		const out: string[] = [];
		let i = 0;
		let replaced = false;
		while (i < lines.length) {
			const line = lines[i] ?? "";
			if (!replaced && line.startsWith("<<<<<<<")) {
				let end = i + 1;
				while (
					end < lines.length &&
					!(lines[end] ?? "").startsWith(">>>>>>>")
				) {
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
				const pick =
					side === "left"
						? buffers.side1
						: side === "right"
							? buffers.side2
							: buffers.base;
				out.push(...pick);
				i = end + 1;
				replaced = true;
				continue;
			}
			out.push(line);
			i += 1;
		}
		setEditor(out.join("\n"));
	};

	const firstRegion = regions[0];
	const conflictFiles = listQuery.data ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[960px] w-[90vw] h-[80vh] p-0 gap-0 flex flex-col">
				<DialogHeader className="px-4 pt-3 pb-2 border-b border-border">
					<DialogTitle className="text-sm font-medium flex items-center gap-2">
						<VscWarning className="size-4 text-yellow-500" />
						Resolve conflicts
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-1 min-h-0">
					{/* File list */}
					<div className="w-56 shrink-0 border-r border-border overflow-y-auto">
						{conflictFiles.length === 0 ? (
							<div className="p-3 text-xs text-muted-foreground">
								{listQuery.isLoading ? "Loading…" : "No conflicted files"}
							</div>
						) : (
							conflictFiles.map((f) => (
								<button
									key={f.path}
									type="button"
									className={cn(
										"w-full text-left px-3 py-2 text-xs truncate hover:bg-accent/30",
										selectedPath === f.path && "bg-accent/50",
									)}
									onClick={() => setSelectedPath(f.path)}
								>
									{f.path}
								</button>
							))
						)}
					</div>

					{/* Editor */}
					<div className="flex-1 flex flex-col min-w-0">
						{!selectedPath ? (
							<div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
								Pick a file to resolve
							</div>
						) : (
							<>
								<div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
									<span className="font-mono truncate flex-1">
										{selectedPath}
									</span>
									<span className="text-muted-foreground shrink-0">
										{regions.length} region{regions.length === 1 ? "" : "s"}
									</span>
									<Button
										variant="outline"
										size="sm"
										className="h-6 text-[11px] px-2"
										disabled={regions.length === 0}
										onClick={() => applySide("left")}
									>
										Use side #1
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="h-6 text-[11px] px-2"
										disabled={regions.length === 0}
										onClick={() => applySide("base")}
									>
										Use base
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="h-6 text-[11px] px-2"
										disabled={regions.length === 0}
										onClick={() => applySide("right")}
									>
										Use side #2
									</Button>
								</div>
								<div className="flex flex-1 min-h-0">
									<Panel
										title="Side #1"
										body={firstRegion?.left ?? ""}
										emptyMessage="Nothing to show"
									/>
									<div className="flex-1 flex flex-col min-w-0 border-x border-border">
										<div className="px-3 py-1 text-[11px] text-muted-foreground border-b border-border">
											Result (editable)
										</div>
										<textarea
											value={editor}
											onChange={(e) => setEditor(e.target.value)}
											className="flex-1 resize-none p-3 font-mono text-xs focus:outline-none bg-transparent"
											spellCheck={false}
										/>
									</div>
									<Panel
										title="Side #2"
										body={firstRegion?.right ?? ""}
										emptyMessage="Nothing to show"
									/>
								</div>
							</>
						)}
					</div>
				</div>

				<div className="flex items-center gap-2 px-4 py-2 border-t border-border">
					<span className="text-[11px] text-muted-foreground">
						{unresolved
							? `${regions.length} unresolved region${regions.length === 1 ? "" : "s"} remaining`
							: "All markers cleared"}
					</span>
					<span className="flex-1" />
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={() => onOpenChange(false)}
					>
						Close
					</Button>
					<Button
						size="sm"
						className="h-7 px-3 text-xs"
						disabled={!dirty || resolveMutation.isPending || !selectedPath}
						onClick={handleSave}
					>
						{resolveMutation.isPending ? "Saving…" : "Save resolution"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function Panel({
	title,
	body,
	emptyMessage,
}: {
	title: string;
	body: string;
	emptyMessage: string;
}) {
	return (
		<div className="w-64 shrink-0 flex flex-col">
			<div className="px-3 py-1 text-[11px] text-muted-foreground border-b border-border">
				{title}
			</div>
			<pre className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre bg-muted/30">
				{body || <span className="text-muted-foreground">{emptyMessage}</span>}
			</pre>
		</div>
	);
}
