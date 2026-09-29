CREATE TABLE "report_receipts" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"fy" integer NOT NULL,
	"reference" text NOT NULL,
	"source" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"late" boolean NOT NULL,
	"counts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_reminders" (
	"report_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"days_before" integer NOT NULL,
	"recipients" integer NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_reminders_report_id_days_before_pk" PRIMARY KEY("report_id","days_before")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text NOT NULL,
	"principal_subject" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" json,
	"claim_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_principal_subject_pk" PRIMARY KEY("key","principal_subject")
);
--> statement-breakpoint
CREATE TABLE "numbering_counters" (
	"scheme" text NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"period" integer DEFAULT 0 NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "numbering_counters_scheme_issuer_period_pk" PRIMARY KEY("scheme","issuer","period")
);
--> statement-breakpoint
ALTER TABLE "report_receipts" ADD CONSTRAINT "report_receipts_report_id_compliance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."compliance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_reminders" ADD CONSTRAINT "report_reminders_report_id_compliance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."compliance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_receipts_tenant_fy_key" ON "report_receipts" USING btree ("tenant","fy");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");
--> statement-breakpoint
-- Reminders are tenant data. EACC's receipts are the Commission's own, and EACC (`app.tenant`
-- `eacc`) reads every Commission's for its intake; only the Commission or platform writes them.
ALTER TABLE "report_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "report_reminders_tenant_isolation" ON "report_reminders"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "report_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_receipts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "report_receipts_tenant_or_eacc" ON "report_receipts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) IN ('platform', 'eacc'))
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
