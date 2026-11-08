CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_person` ON `contacts` (`person_id`);--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT '' NOT NULL,
	`parent_id` text,
	`other_names` text DEFAULT '[]' NOT NULL,
	`lat` real,
	`lon` real,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `places_parent` ON `places` (`parent_id`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `persons` ADD `no_children` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `persons` ADD `never_married` integer DEFAULT false NOT NULL;