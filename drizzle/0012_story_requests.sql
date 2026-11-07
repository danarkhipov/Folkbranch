CREATE TABLE `story_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`person_id` text NOT NULL,
	`teller_name` text DEFAULT '' NOT NULL,
	`question` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`received` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_requests_token_hash_unique` ON `story_requests` (`token_hash`);