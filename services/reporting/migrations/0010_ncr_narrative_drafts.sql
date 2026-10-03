CREATE TABLE "national_report_narrative_drafts" (
	"national_report_id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"section" text NOT NULL,
	"replace_all" boolean NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"aggregates_built_at" timestamp with time zone NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "national_report_narrative_drafts" ADD CONSTRAINT "national_report_narrative_drafts_national_report_id_national_reports_id_fk" FOREIGN KEY ("national_report_id") REFERENCES "public"."national_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "national_report_narrative_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "national_report_narrative_drafts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "national_report_narrative_drafts_eacc" ON "national_report_narrative_drafts"
	USING (current_setting('app.tenant', true) IN ('eacc', 'platform'))
	WITH CHECK (current_setting('app.tenant', true) IN ('eacc', 'platform'));
