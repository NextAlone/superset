import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { VscBookmark, VscEdit, VscTrash } from "react-icons/vsc";

interface CurrentBookmarkMenuProps {
	bookmark: string | null;
	onCreateAtHead: () => void;
	onRename: (name: string) => void;
	onDelete: (name: string) => void;
}

export function CurrentBookmarkMenu({
	bookmark,
	onCreateAtHead,
	onRename,
	onDelete,
}: CurrentBookmarkMenuProps) {
	const label = bookmark ?? "no bookmark";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground font-mono hover:bg-accent/80 cursor-pointer"
				>
					{label}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				<DropdownMenuItem onSelect={onCreateAtHead}>
					<VscBookmark className="size-3.5 mr-2" />
					Create bookmark here…
				</DropdownMenuItem>
				{bookmark ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => onRename(bookmark)}>
							<VscEdit className="size-3.5 mr-2" />
							Rename "{bookmark}"…
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onSelect={() => onDelete(bookmark)}
						>
							<VscTrash className="size-3.5 mr-2" />
							Delete "{bookmark}"
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
