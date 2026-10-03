CREATE TABLE "review_copilot_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"selection_hash" text NOT NULL,
	"job_id" uuid,
	"status" text NOT NULL,
	"failure_reason" text,
	"ciphertext" text,
	"envelope" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "review_copilot_drafts_status_check" CHECK ("review_copilot_drafts"."status" in ('pending', 'ready', 'failed')),
	CONSTRAINT "review_copilot_drafts_content_check" CHECK (("review_copilot_drafts"."status" = 'ready' and "review_copilot_drafts"."purged_at" is null) = ("review_copilot_drafts"."ciphertext" is not null and "review_copilot_drafts"."envelope" is not null))
);
--> statement-breakpoint
CREATE TABLE "review_copilot_ratings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"reviewer_subject" text NOT NULL,
	"block" text,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"rated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_copilot_ratings_job_reviewer_block_key" UNIQUE NULLS NOT DISTINCT("job_id","reviewer_subject","block"),
	CONSTRAINT "review_copilot_ratings_rating_check" CHECK ("review_copilot_ratings"."rating" in ('helpful', 'not-helpful'))
);
--> statement-breakpoint
CREATE TABLE "review_copilots" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"status" text NOT NULL,
	"for_version_id" uuid NOT NULL,
	"registry_checked_at" timestamp with time zone,
	"attempt" integer NOT NULL,
	"requested_summary_job_id" uuid,
	"requested_explanations_job_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"failure_reason" text,
	"generated_for_version_id" uuid,
	"generated_at" timestamp with time zone,
	"summary_job_id" uuid,
	"summary_prompt_version" integer,
	"summary_ciphertext" text,
	"summary_envelope" jsonb,
	"explanations_job_id" uuid,
	"explanations_prompt_version" integer,
	"explanations_ciphertext" text,
	"explanations_envelope" jsonb,
	"staged_summary_prompt_version" integer,
	"staged_summary_ciphertext" text,
	"staged_summary_envelope" jsonb,
	"staged_explanations_prompt_version" integer,
	"staged_explanations_ciphertext" text,
	"staged_explanations_envelope" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_copilots_status_check" CHECK ("review_copilots"."status" in ('not-enabled', 'pending', 'ready', 'failed', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "clarifications" ADD COLUMN "opening" text;--> statement-breakpoint
ALTER TABLE "clarifications" ADD COLUMN "opening_ai_job_id" uuid;--> statement-breakpoint
ALTER TABLE "clarifications" ADD COLUMN "ai_assisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" ADD CONSTRAINT "review_copilot_drafts_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_copilot_ratings" ADD CONSTRAINT "review_copilot_ratings_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD CONSTRAINT "review_copilots_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_copilot_drafts_expires_at_idx" ON "review_copilot_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "review_copilots_summary_job_id_idx" ON "review_copilots" USING btree ("summary_job_id");--> statement-breakpoint
CREATE INDEX "review_copilots_explanations_job_id_idx" ON "review_copilots" USING btree ("explanations_job_id");--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls). No person policy: the declarant
-- never reads the copilot of their case, its ratings or a reviewer's AI drafts (spec 07c).
ALTER TABLE "review_copilots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_copilots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_copilots_tenant_isolation" ON "review_copilots"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "review_copilot_ratings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_copilot_ratings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_copilot_ratings_tenant_isolation" ON "review_copilot_ratings"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_copilot_drafts_tenant_isolation" ON "review_copilot_drafts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
