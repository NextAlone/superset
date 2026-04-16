import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superset/ui/alert-dialog";
import { Button } from "@superset/ui/button";
import type { ReactNode } from "react";

export interface ConfirmRequest {
	title: string;
	description?: ReactNode;
	confirmLabel?: string;
	destructive?: boolean;
	onConfirm: () => void;
}

interface ConfirmDialogProps {
	request: ConfirmRequest | null;
	onCancel: () => void;
	isPending?: boolean;
}

export function ConfirmDialog({
	request,
	onCancel,
	isPending = false,
}: ConfirmDialogProps) {
	if (!request) return null;

	return (
		<AlertDialog
			open={!!request}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<AlertDialogContent className="max-w-sm gap-0 p-0">
				<AlertDialogHeader className="px-4 pt-4 pb-2">
					<AlertDialogTitle className="font-medium">
						{request.title}
					</AlertDialogTitle>
					{request.description ? (
						<AlertDialogDescription>
							{request.description}
						</AlertDialogDescription>
					) : null}
				</AlertDialogHeader>
				<AlertDialogFooter className="px-4 pb-4 pt-2 flex-row justify-end gap-2">
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
						variant={request.destructive ? "destructive" : "default"}
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={request.onConfirm}
						disabled={isPending}
					>
						{isPending ? "Working…" : (request.confirmLabel ?? "Confirm")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
