CREATE TABLE "review_copilot_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"job_id" uuid,
	"status" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_copilot_drafts_status_check" CHECK ("review_copilot_drafts"."status" in ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" ADD CONSTRAINT "review_copilot_drafts_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_copilot_drafts_expires_at_idx" ON "review_copilot_drafts" USING btree ("expires_at");--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls). No person policy: the declarant
-- never reads a reviewer's AI drafts (spec 07c).
ALTER TABLE "review_copilot_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_copilot_drafts_tenant_isolation" ON "review_copilot_drafts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
