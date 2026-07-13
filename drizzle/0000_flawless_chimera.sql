CREATE TABLE `exercise_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`default_weight_kg` real NOT NULL,
	`default_reps` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_presets_device_name_idx` ON `exercise_presets` (`device_id`,`name`);--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`workout_date` text NOT NULL,
	`completed_at` integer NOT NULL,
	`exercise` text NOT NULL,
	`weight_kg` real NOT NULL,
	`reps` integer NOT NULL,
	`heart_rate_bpm` integer
);
--> statement-breakpoint
CREATE INDEX `workout_sets_device_date_idx` ON `workout_sets` (`device_id`,`workout_date`);