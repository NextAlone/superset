import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface GitInitDialogState {
	isOpen: boolean;
	isPending: boolean;
	paths: string[];
	onInit: (() => void) | null;
	onOpenAsFolder: (() => void) | null;
	onCancel: (() => void) | null;
	open: (params: {
		paths: string[];
		onInit: () => void;
		onOpenAsFolder: () => void;
		onCancel: () => void;
	}) => void;
	setIsPending: (isPending: boolean) => void;
	close: () => void;
}

export const useGitInitDialogStore = create<GitInitDialogState>()(
	devtools(
		(set) => ({
			isOpen: false,
			isPending: false,
			paths: [],
			onInit: null,
			onOpenAsFolder: null,
			onCancel: null,

			open: ({ paths, onInit, onOpenAsFolder, onCancel }) => {
				set({
					isOpen: true,
					isPending: false,
					paths,
					onInit,
					onOpenAsFolder,
					onCancel,
				});
			},

			setIsPending: (isPending) => {
				set({ isPending });
			},

			close: () => {
				set({
					isOpen: false,
					isPending: false,
					paths: [],
					onInit: null,
					onOpenAsFolder: null,
					onCancel: null,
				});
			},
		}),
		{ name: "GitInitDialogStore" },
	),
);
