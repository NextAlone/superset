import { cn } from "@superset/ui/utils";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import type { ActivePaneStatus } from "shared/tabs-types";
import type { DashboardSidebarWorkspaceHostType } from "../../../../types";
import { DashboardSidebarWorkspaceIcon } from "../DashboardSidebarWorkspaceIcon";

interface DashboardSidebarCollapsedWorkspaceButtonProps
	extends ComponentPropsWithoutRef<"button"> {
	hostType: DashboardSidebarWorkspaceHostType;
	hostIsOnline: boolean | null;
	isActive: boolean;
	workspaceStatus?: ActivePaneStatus | null;
	creationStatus?: "preparing" | "generating-branch" | "creating" | "failed";
}

export const DashboardSidebarCollapsedWorkspaceButton = forwardRef<
	HTMLButtonElement,
	DashboardSidebarCollapsedWorkspaceButtonProps
>(
	(
		{
			hostType,
			hostIsOnline,
			isActive,
			workspaceStatus = null,
			creationStatus,
			className,
			...props
		},
		ref,
	) => {
		const hasAttentionStatus =
			workspaceStatus === "review" || workspaceStatus === "permission";

		return (
			<button
				type="button"
				ref={ref}
				className={cn(
					"relative flex items-center justify-center size-8 rounded-md",
					"hover:bg-muted/50 transition-colors cursor-pointer",
					isActive && "bg-muted",
					isActive && hasAttentionStatus && "animate-pulse",
					className,
				)}
				style={
					hasAttentionStatus
						? {
								backgroundColor:
									workspaceStatus === "review"
										? "rgba(34,197,94,0.12)"
										: "rgba(239,68,68,0.14)",
								boxShadow:
									workspaceStatus === "review"
										? "inset 0 0 0 1px rgba(34,197,94,0.45)"
										: "inset 0 0 0 1px rgba(239,68,68,0.55)",
							}
						: undefined
				}
				{...props}
			>
				<DashboardSidebarWorkspaceIcon
					hostType={hostType}
					hostIsOnline={hostIsOnline}
					isActive={isActive}
					variant="collapsed"
					workspaceStatus={workspaceStatus}
					creationStatus={creationStatus}
				/>
			</button>
		);
	},
);
