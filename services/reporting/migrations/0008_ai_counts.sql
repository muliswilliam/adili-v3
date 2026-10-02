CREATE TABLE "ai_feedback_facts" (
	"feedback_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"job_id" uuid NOT NULL,
	"task" text NOT NULL,
	"rating" text NOT NULL,
	"reason" text,
	"fy" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_case_facts" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp with time zone NOT NULL,
	"first_ready_at" timestamp with time zone,
	"fy" integer
);
--> statement-breakpoint
CREATE INDEX "ai_feedback_facts_tenant_fy_idx" ON "ai_feedback_facts" USING btree ("tenant","fy");--> statement-breakpoint
CREATE INDEX "copilot_case_facts_tenant_fy_idx" ON "copilot_case_facts" USING btree ("tenant","fy");
--> statement-breakpoint
-- Tenant data like every fact table (see 0002_reporting_rls); EACC (`app.tenant` `eacc`) reads
-- every Commission's for its AI usage counts (spec 07c story 19), as it does report receipts. Only
-- the Commission or platform writes them.
ALTER TABLE "ai_feedback_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_feedback_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ai_feedback_facts_tenant_or_eacc" ON "ai_feedback_facts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) IN ('platform', 'eacc'))
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "copilot_case_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "copilot_case_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "copilot_case_facts_tenant_or_eacc" ON "copilot_case_facts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) IN ('platform', 'eacc'))
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
