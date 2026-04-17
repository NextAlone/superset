import { Button } from "@superset/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useMemo, useState } from "react";
import { VscCheck, VscGitPullRequest } from "react-icons/vsc";
import { electronTrpc } from "renderer/lib/electron-trpc";

const BRANCH_QUERY_STALE_TIME_MS = 10_000;

interface Props {
	worktreePath: string;
	effectiveBaseBookmark: string;
	defaultBookmark: string;
}

export function JjBaseBookmarkSelector({
	worktreePath,
	effectiveBaseBookmark,
	defaultBookmark,
}: Props) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const utils = electronTrpc.useUtils();
	const { data: branchData, isLoading } =
		electronTrpc.changes.getBranches.useQuery(
			{ worktreePath },
			{
				enabled: !!worktreePath,
				staleTime: BRANCH_QUERY_STALE_TIME_MS,
				refetchOnWindowFocus: false,
			},
		);

	const updateBaseBranch = electronTrpc.changes.updateBaseBranch.useMutation({
		onSuccess: () => {
			utils.changes.getBranches.invalidate({ worktreePath });
		},
	});

	const sortedBookmarks = useMemo(() => {
		const all = branchData?.remote ?? [];
		return [...all].sort((a, b) => {
			if (a === effectiveBaseBookmark) return -1;
			if (b === effectiveBaseBookmark) return 1;
			if (a === defaultBookmark) return -1;
			if (b === defaultBookmark) return 1;
			return a.localeCompare(b);
		});
	}, [branchData?.remote, defaultBookmark, effectiveBaseBookmark]);

	const filtered = useMemo(() => {
		if (!search) return sortedBookmarks.filter(Boolean);
		const lower = search.toLowerCase();
		return sortedBookmarks.filter((b) => b?.toLowerCase().includes(lower));
	}, [sortedBookmarks, search]);

	const handleSelect = (bookmark: string) => {
		updateBaseBranch.mutate({
			worktreePath,
			baseBranch: bookmark === defaultBookmark ? null : bookmark,
		});
		setOpen(false);
		setSearch("");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-5 px-1.5 text-xs font-mono text-muted-foreground hover:text-foreground gap-1"
							disabled={isLoading}
						>
							<VscGitPullRequest className="size-3" />
							{effectiveBaseBookmark}
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom" showArrow={false}>
					Change base bookmark
				</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" className="w-56 p-0">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search bookmarks..."
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList className="max-h-[200px]">
						<CommandEmpty>No bookmarks found</CommandEmpty>
						{filtered.map((bookmark) => (
							<CommandItem
								key={bookmark}
								value={bookmark}
								onSelect={() => handleSelect(bookmark)}
								className="flex items-center justify-between text-xs"
							>
								<span className="truncate">
									{bookmark}
									{bookmark === defaultBookmark && (
										<span className="ml-1 text-muted-foreground">
											(default)
										</span>
									)}
								</span>
								{bookmark === effectiveBaseBookmark && (
									<VscCheck className="size-3.5 shrink-0 text-primary" />
								)}
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
