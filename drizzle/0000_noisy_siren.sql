CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`actor_name` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`person_ids` text DEFAULT '[]' NOT NULL,
	`changes` text DEFAULT '[]' NOT NULL,
	`key` text,
	`undo_of` text,
	`undone_at` integer
);
--> statement-breakpoint
CREATE INDEX `history_at` ON `history` (`at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`person_id` text,
	`user_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'image' NOT NULL,
	`filename` text NOT NULL,
	`original_name` text DEFAULT '' NOT NULL,
	`mime` text NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`place` text DEFAULT '' NOT NULL,
	`uploaded_by` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`person_id` text NOT NULL,
	`x` real,
	`y` real,
	`w` real,
	`h` real
);
--> statement-breakpoint
CREATE INDEX `media_tags_media` ON `media_tags` (`media_id`);--> statement-breakpoint
CREATE INDEX `media_tags_person` ON `media_tags` (`person_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`parent_page_id` text,
	`title` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`content` text DEFAULT '[]' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pages_person` ON `pages` (`person_id`);--> statement-breakpoint
CREATE TABLE `parent_child` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`child_id` text NOT NULL,
	`kind` text DEFAULT 'birth' NOT NULL,
	`certainty` text DEFAULT 'family' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parent_child_pair` ON `parent_child` (`parent_id`,`child_id`);--> statement-breakpoint
CREATE INDEX `parent_child_child` ON `parent_child` (`child_id`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`given_name` text DEFAULT '' NOT NULL,
	`surname` text DEFAULT '' NOT NULL,
	`maiden_name` text DEFAULT '' NOT NULL,
	`sex` text DEFAULT 'U' NOT NULL,
	`birth_date` text DEFAULT '' NOT NULL,
	`birth_year` integer,
	`birth_place` text DEFAULT '' NOT NULL,
	`death_date` text DEFAULT '' NOT NULL,
	`death_year` integer,
	`death_place` text DEFAULT '' NOT NULL,
	`living` integer DEFAULT true NOT NULL,
	`certainty` text DEFAULT 'family' NOT NULL,
	`avatar_media_id` text,
	`avatar_crop` text,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `unions` (
	`id` text PRIMARY KEY NOT NULL,
	`a_id` text NOT NULL,
	`b_id` text NOT NULL,
	`kind` text DEFAULT 'marriage' NOT NULL,
	`start_date` text DEFAULT '' NOT NULL,
	`end_date` text DEFAULT '' NOT NULL,
	`certainty` text DEFAULT 'family' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unions_pair` ON `unions` (`a_id`,`b_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'reader' NOT NULL,
	`person_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
