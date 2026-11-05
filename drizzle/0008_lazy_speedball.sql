PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`person_id` text,
	`label` text,
	`x` real,
	`y` real,
	`w` real,
	`h` real
);
--> statement-breakpoint
INSERT INTO `__new_media_tags`("id", "media_id", "person_id", "x", "y", "w", "h") SELECT "id", "media_id", "person_id", "x", "y", "w", "h" FROM `media_tags`;--> statement-breakpoint
DROP TABLE `media_tags`;--> statement-breakpoint
ALTER TABLE `__new_media_tags` RENAME TO `media_tags`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `media_tags_media` ON `media_tags` (`media_id`);--> statement-breakpoint
CREATE INDEX `media_tags_person` ON `media_tags` (`person_id`);