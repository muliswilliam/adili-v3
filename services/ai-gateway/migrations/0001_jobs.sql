CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"task" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"data_class" text NOT NULL,
	"subject_ref" text NOT NULL,
	"caller" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"input" jsonb,
	"status" text NOT NULL,
	"reason" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"output" jsonb,
	"output_hash" text,
	"output_purged_at" timestamp with time zone,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_reason_matches_status" CHECK (("jobs"."status" in ('failed', 'blocked')) = ("jobs"."reason" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_caller_idempotency_key_idx" ON "jobs" USING btree ("caller","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_cache_idx" ON "jobs" USING btree ("tenant","caller","subject_ref","data_class","task","prompt_version","provider","model","input_hash") WHERE "jobs"."status" in ('queued', 'running', 'succeeded') and "jobs"."output_purged_at" is null;--> statement-breakpoint
CREATE INDEX "jobs_live_idx" ON "jobs" USING btree ("id") WHERE "jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "jobs_output_retention_idx" ON "jobs" USING btree ("finished_at") WHERE "jobs"."output" is not null;