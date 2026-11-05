CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT 'all' NOT NULL,
	`focus_id` text,
	`collapsed` text DEFAULT '[]' NOT NULL,
	`pins` text DEFAULT '{}' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
