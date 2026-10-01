CREATE TABLE "report_chases" (
	"tenant" text NOT NULL,
	"fy" integer NOT NULL,
	"round" integer NOT NULL,
	"recipients" integer NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_chases_tenant_fy_round_pk" PRIMARY KEY("tenant","fy","round")
);
--> statement-breakpoint
ALTER TABLE "report_receipts" ADD COLUMN "form_m_document_id" uuid;--> statement-breakpoint
ALTER TABLE "report_receipts" ADD COLUMN "receipt_document_id" uuid;--> statement-breakpoint
-- Chases are the Commission's own, and EACC (`app.tenant` `eacc`) reads every Commission's for its
-- intake; only the Commission's context or platform writes them.
ALTER TABLE "report_chases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_chases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "report_chases_tenant_or_eacc" ON "report_chases"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) IN ('platform', 'eacc'))
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- EACC reads every Commission's submitted report as filed (spec 09 authorisation; ADR-006: Form M,
-- never the declarations). Drafts stay the Commission's own.
CREATE POLICY "compliance_reports_eacc_reads_submitted" ON "compliance_reports"
	FOR SELECT
	USING (current_setting('app.tenant', true) = 'eacc' AND "status" = 'submitted');
