CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`teller_name` text DEFAULT '' NOT NULL,
	`told_on` text DEFAULT '' NOT NULL,
	`media_id` text,
	`duration_sec` integer,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `story_people` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text DEFAULT 'about' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `story_people_story` ON `story_people` (`story_id`);--> statement-breakpoint
CREATE INDEX `story_people_person` ON `story_people` (`person_id`);