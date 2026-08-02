CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`payload` text,
	`result` text NOT NULL,
	`http_status` integer NOT NULL,
	`error` text,
	CONSTRAINT "audit_log_result_valid" CHECK("result" IN ('ok', 'error'))
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_user_idx` ON `audit_log` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_role_valid" CHECK("role" IN ('viewer', 'operator', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);