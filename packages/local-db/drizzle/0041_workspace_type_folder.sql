PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`worktree_id` text,
	`type` text NOT NULL,
	`branch` text,
	`name` text NOT NULL,
	`tab_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_opened_at` integer NOT NULL,
	`is_unread` integer DEFAULT false,
	`is_unnamed` integer DEFAULT false,
	`deleting_at` integer,
	`port_base` integer,
	`section_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `workspace_sections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "project_id", "worktree_id", "type", "branch", "name", "tab_order", "created_at", "updated_at", "last_opened_at", "is_unread", "is_unnamed", "deleting_at", "port_base", "section_id") SELECT "id", "project_id", "worktree_id", "type", "branch", "name", "tab_order", "created_at", "updated_at", "last_opened_at", "is_unread", "is_unnamed", "deleting_at", "port_base", "section_id" FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `workspaces_project_id_idx` ON `workspaces` (`project_id`);--> statement-breakpoint
CREATE INDEX `workspaces_worktree_id_idx` ON `workspaces` (`worktree_id`);--> statement-breakpoint
CREATE INDEX `workspaces_last_opened_at_idx` ON `workspaces` (`last_opened_at`);--> statement-breakpoint
CREATE INDEX `workspaces_section_id_idx` ON `workspaces` (`section_id`);