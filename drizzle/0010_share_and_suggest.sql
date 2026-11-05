ALTER TABLE `proposals` RENAME COLUMN `token_id` TO `author_id`;--> statement-breakpoint
ALTER TABLE `proposals` RENAME COLUMN `token_name` TO `author_name`;--> statement-breakpoint
ALTER TABLE `proposals` ADD `author_kind` text DEFAULT 'token' NOT NULL;--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`view_id` text,
	`password_hash` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`opens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);
