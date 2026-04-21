import { useEffect, useRef, useState } from "react";
import { useUpdateWorkspace } from "renderer/react-query/workspaces/useUpdateWorkspace";

export function useWorkspaceRename(
	workspaceId: string,
	workspaceName: string,
	branch: string | null,
) {
	const [isRenaming, setIsRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(workspaceName);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const updateWorkspace = useUpdateWorkspace();

	useEffect(() => {
		if (isRenaming && inputRef.current) {
			inputRef.current.select();
		}
	}, [isRenaming]);

	useEffect(() => {
		setRenameValue(workspaceName);
	}, [workspaceName]);

	const startRename = () => {
		setIsRenaming(true);
	};

	const submitRename = () => {
		const trimmedValue = renameValue.trim();
		const isCleared = !trimmedValue;

		if (isCleared) {
			const fallbackName = branch ?? workspaceName;
			updateWorkspace.mutate({
				id: workspaceId,
				patch: { name: fallbackName, isUnnamed: true },
			});
			setRenameValue(fallbackName);
		} else if (trimmedValue !== workspaceName) {
			updateWorkspace.mutate({
				id: workspaceId,
				patch: { name: trimmedValue },
			});
		} else {
			setRenameValue(workspaceName);
		}
		setIsRenaming(false);
	};

	const cancelRename = () => {
		setRenameValue(workspaceName);
		setIsRenaming(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			submitRename();
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancelRename();
		}
	};

	return {
		isRenaming,
		renameValue,
		inputRef,
		setRenameValue,
		startRename,
		submitRename,
		cancelRename,
		handleKeyDown,
	};
}
