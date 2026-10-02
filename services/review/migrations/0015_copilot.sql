CREATE TABLE "review_copilots" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"status" text NOT NULL,
	"for_version_id" uuid NOT NULL,
	"registry_checked_at" timestamp with time zone,
	"attempt" integer NOT NULL,
	"summarize_job_id" uuid,
	"explain_job_id" uuid,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_copilots_status_check" CHECK ("review_copilots"."status" in ('not-enabled', 'pending', 'ready', 'failed', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "review_copilots" ADD CONSTRAINT "review_copilots_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls). No person policy: the declarant
-- never reads the copilot of their case (spec 07c).
ALTER TABLE "review_copilots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_copilots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_copilots_tenant_isolation" ON "review_copilots"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
