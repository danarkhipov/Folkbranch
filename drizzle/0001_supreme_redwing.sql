CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`review` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`token_id` text NOT NULL,
	`token_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ops` text DEFAULT '[]' NOT NULL,
	`id_map` text DEFAULT '{}' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`history_id` text
);
--> statement-breakpoint
CREATE INDEX `proposals_status` ON `proposals` (`status`);--> statement-breakpoint
ALTER TABLE `history` ADD `token_id` text;