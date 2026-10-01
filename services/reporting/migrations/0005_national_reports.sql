CREATE TABLE "national_report_aggregates" (
	"national_report_id" uuid PRIMARY KEY NOT NULL,
	"fy" integer NOT NULL,
	"built_at" timestamp with time zone NOT NULL,
	"reports_included" integer NOT NULL,
	"report_ids" jsonb NOT NULL,
	"aggregates" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "national_report_paragraphs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"national_report_id" uuid NOT NULL,
	"section" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"ai_draft" boolean DEFAULT false NOT NULL,
	"aggregate_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "national_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fy" integer NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"author_subject" text NOT NULL,
	"author_name" text NOT NULL,
	"contributors" jsonb NOT NULL,
	"approver_subject" text,
	"approver_name" text,
	"reference" text,
	"document_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "national_report_aggregates" ADD CONSTRAINT "national_report_aggregates_national_report_id_national_reports_id_fk" FOREIGN KEY ("national_report_id") REFERENCES "public"."national_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "national_report_paragraphs" ADD CONSTRAINT "national_report_paragraphs_national_report_id_national_reports_id_fk" FOREIGN KEY ("national_report_id") REFERENCES "public"."national_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "national_report_paragraphs_report_idx" ON "national_report_paragraphs" USING btree ("national_report_id","section","position");--> statement-breakpoint
CREATE UNIQUE INDEX "national_reports_fy_key" ON "national_reports" USING btree ("fy");--> statement-breakpoint
-- The national consolidated report is EACC's (`app.tenant` `eacc`), not a Commission's: EACC and
-- platform read and write it; a Commission's context sees none of it.
ALTER TABLE "national_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "national_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "national_reports_eacc" ON "national_reports"
	USING (current_setting('app.tenant', true) IN ('eacc', 'platform'))
	WITH CHECK (current_setting('app.tenant', true) IN ('eacc', 'platform'));
--> statement-breakpoint
ALTER TABLE "national_report_aggregates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "national_report_aggregates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "national_report_aggregates_eacc" ON "national_report_aggregates"
	USING (current_setting('app.tenant', true) IN ('eacc', 'platform'))
	WITH CHECK (current_setting('app.tenant', true) IN ('eacc', 'platform'));
--> statement-breakpoint
ALTER TABLE "national_report_paragraphs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "national_report_paragraphs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "national_report_paragraphs_eacc" ON "national_report_paragraphs"
	USING (current_setting('app.tenant', true) IN ('eacc', 'platform'))
	WITH CHECK (current_setting('app.tenant', true) IN ('eacc', 'platform'));
