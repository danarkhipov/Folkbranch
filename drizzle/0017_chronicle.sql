CREATE TABLE `chronicle` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`from_year` real NOT NULL,
	`to_year` real NOT NULL,
	`date_from` text NOT NULL,
	`date_to` text DEFAULT '' NOT NULL,
	`lead` integer DEFAULT 0 NOT NULL,
	`names_people` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '{}' NOT NULL,
	`link` text DEFAULT '{}' NOT NULL,
	`shape` text,
	`people` text DEFAULT '[]' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_key_unique` ON `chronicle` (`key`);--> statement-breakpoint
CREATE INDEX `chronicle_years` ON `chronicle` (`from_year`);