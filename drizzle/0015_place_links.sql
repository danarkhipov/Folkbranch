ALTER TABLE `persons` ADD `birth_place_id` text;--> statement-breakpoint
ALTER TABLE `persons` ADD `death_place_id` text;--> statement-breakpoint
CREATE INDEX `persons_birth_place` ON `persons` (`birth_place_id`);--> statement-breakpoint
CREATE INDEX `persons_death_place` ON `persons` (`death_place_id`);--> statement-breakpoint
ALTER TABLE `unions` ADD `place_id` text;