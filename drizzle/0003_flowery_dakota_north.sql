ALTER TABLE `persons` ADD `patronymic` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `persons` ADD `other_names` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unions` ADD `place` text DEFAULT '' NOT NULL;