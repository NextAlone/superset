import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { useEffect, useState } from "react";

const BOOKMARK_NAME_REGEX = /^[a-zA-Z0-9._/-]+$/;

export interface BookmarkPromptRequest {
	mode: "create" | "rename";
	initialValue?: string;
	disallowed?: string[];
	context?: string;
}

interface BookmarkPromptDialogProps {
	request: BookmarkPromptRequest | null;
	onCancel: () => void;
	onSubmit: (name: string) => void;
	isPending?: boolean;
}

export function BookmarkPromptDialog({
	request,
	onCancel,
	onSubmit,
	isPending = false,
}: BookmarkPromptDialogProps) {
	const [value, setValue] = useState("");

	useEffect(() => {
		if (request) setValue(request.initialValue ?? "");
	}, [request]);

	if (!request) return null;

	const trimmed = value.trim();
	const isValid = BOOKMARK_NAME_REGEX.test(trimmed);
	const isDuplicate =
		!!trimmed &&
		(request.disallowed ?? []).includes(trimmed) &&
		trimmed !== request.initialValue;
	const canSubmit =
		!isPending &&
		isValid &&
		!isDuplicate &&
		trimmed !== (request.initialValue ?? "");

	const title =
		request.mode === "create" ? "Create bookmark" : "Rename bookmark";
	const description =
		request.mode === "create"
			? `Create a new bookmark${request.context ? ` on ${request.context}` : ""}.`
			: `Rename "${request.initialValue ?? ""}".`;

	const handleSubmit = () => {
		if (!canSubmit) return;
		onSubmit(trimmed);
	};

	return (
		<Dialog
			open={!!request}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<DialogContent className="max-w-sm gap-0 p-0">
				<DialogHeader className="px-4 pt-4 pb-2">
					<DialogTitle className="font-medium">{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<div className="px-4 pb-2 space-y-1">
					<Input
						autoFocus
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								handleSubmit();
							}
						}}
						placeholder="feature/my-bookmark"
						className="h-8 text-xs"
					/>
					{trimmed && !isValid ? (
						<p className="text-[11px] text-destructive">
							Only letters, digits, ., _, /, -
						</p>
					) : isDuplicate ? (
						<p className="text-[11px] text-destructive">Name already exists</p>
					) : null}
				</div>
				<DialogFooter className="px-4 pb-4 pt-2 flex-row justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={onCancel}
						disabled={isPending}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={handleSubmit}
						disabled={!canSubmit}
					>
						{isPending
							? "Working…"
							: request.mode === "create"
								? "Create"
								: "Rename"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
