CREATE TYPE "public"."task_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "eval_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"eval_name" text NOT NULL,
	"model" text NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"tokens" integer,
	"cost" double precision,
	"steps" integer,
	"tool_calls" integer,
	"duration_ms" integer,
	"output" text,
	"error" text,
	"exit_code" integer,
	"judge_score" double precision,
	"judge_verdict" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "eval_tasks" ADD CONSTRAINT "eval_tasks_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;