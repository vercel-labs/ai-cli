CREATE TABLE "eval_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"eval_name" text NOT NULL,
	"winner_model" text NOT NULL,
	"rankings" text NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_tasks" ADD COLUMN "messages" text;--> statement-breakpoint
ALTER TABLE "eval_comparisons" ADD CONSTRAINT "eval_comparisons_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;