import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { LuGitBranch } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface FolderVcsPlaceholderProps {
	projectMainRepoPath: string | undefined;
}

export function FolderVcsPlaceholder({
	projectMainRepoPath,
}: FolderVcsPlaceholderProps) {
	const initRepo = electronTrpc.projects.initGitAndOpen.useMutation();
	const utils = electronTrpc.useUtils();

	const handleInitialize = async () => {
		if (!projectMainRepoPath) return;
		try {
			await initRepo.mutateAsync({ path: projectMainRepoPath });
			await Promise.all([
				utils.projects.getRecents.invalidate(),
				utils.workspaces.get.invalidate(),
				utils.workspaces.getAll.invalidate(),
				utils.workspaces.getAllGrouped.invalidate(),
			]);
			toast.success("Repository initialized");
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to initialize repo";
			toast.error(message);
		}
	};

	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
			<LuGitBranch className="size-8 opacity-40" />
			<p className="text-sm">This folder is not a git repository yet.</p>
			<p className="text-xs">
				Initialize one to unlock branches, history, and worktrees.
			</p>
			<Button
				size="sm"
				onClick={handleInitialize}
				disabled={initRepo.isPending || !projectMainRepoPath}
			>
				{initRepo.isPending ? "Initializing..." : "Initialize jj repo"}
			</Button>
		</div>
	);
}
