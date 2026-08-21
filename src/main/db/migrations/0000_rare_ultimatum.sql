CREATE TABLE IF NOT EXISTS `benchmark_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`score` real NOT NULL,
	`max_score` real NOT NULL,
	`percentage` real NOT NULL,
	`report_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `file_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text,
	`tool_call_id` text,
	`path` text NOT NULL,
	`content_before` text,
	`content_after` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `messages_fts` USING fts5(
	body,
	message_id UNINDEXED,
	session_id UNINDEXED,
	tokenize = 'unicode61'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`blocks` text NOT NULL,
	`model` text,
	`usage` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`cwd` text NOT NULL,
	`model` text,
	`preset_id` text,
	`effort` text DEFAULT 'high' NOT NULL,
	`permission_mode` text DEFAULT 'manual' NOT NULL,
	`starred` integer DEFAULT 0 NOT NULL,
	`forked_from` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `snippets` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`language` text NOT NULL,
	`code` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_calls` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`message_id` text NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_session` ON `messages`(`session_id`, `seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_calls_session` ON `tool_calls`(`session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_calls_message` ON `tool_calls`(`message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_tool_calls_unique` ON `tool_calls`(`message_id`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_benchmark_runs_time` ON `benchmark_runs`(`created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_snapshots_session` ON `file_snapshots`(`session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_snapshots_message` ON `file_snapshots`(`message_id`);
