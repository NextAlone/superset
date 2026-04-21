export function getWorkspaceDisplayName(
	workspaceName: string,
	workspaceType: "worktree" | "branch" | "folder",
	projectName?: string | null,
): string {
	const suffix =
		workspaceType === "branch"
			? "local"
			: workspaceType === "folder"
				? null
				: workspaceName;
	return [projectName, suffix].filter(Boolean).join(" - ");
}
