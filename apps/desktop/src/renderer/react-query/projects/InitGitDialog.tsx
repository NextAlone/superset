import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superset/ui/alert-dialog";
import { Button } from "@superset/ui/button";
import { useGitInitDialogStore } from "renderer/stores/git-init-dialog";

export function InitGitDialog() {
	const { isOpen, isPending, paths, onInit, onOpenAsFolder, onCancel } =
		useGitInitDialogStore();

	const isSingle = paths.length === 1;

	return (
		<AlertDialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open && !isPending) onCancel?.();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>This folder isn't a repository</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-2">
							{isSingle ? (
								<p>
									<span className="font-medium text-foreground">
										{paths[0]?.split("/").pop()}
									</span>{" "}
									is not a git repository. Initialize one (git + jj) or open it
									as a folder?
								</p>
							) : (
								<>
									<p>
										The following folders are not git repositories. Initialize
										them (git + jj) or open them as folders?
									</p>
									<ul className="list-disc pl-4 space-y-1">
										{paths.map((p) => (
											<li key={p}>
												<span className="font-medium text-foreground">
													{p.split("/").pop()}
												</span>
												<span className="text-xs ml-1 text-muted-foreground">
													{p}
												</span>
											</li>
										))}
									</ul>
								</>
							)}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<Button
						variant="outline"
						disabled={isPending}
						onClick={() => onCancel?.()}
					>
						Cancel
					</Button>
					<Button
						variant="secondary"
						disabled={isPending}
						onClick={() => onOpenAsFolder?.()}
					>
						Open as folder
					</Button>
					<Button disabled={isPending} onClick={() => onInit?.()}>
						{isPending ? "Initializing..." : "Initialize jj repo"}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
