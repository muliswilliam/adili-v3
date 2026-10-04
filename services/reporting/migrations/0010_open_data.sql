CREATE TABLE "open_data_files" (
	"release_id" uuid NOT NULL,
	"table" text NOT NULL,
	"format" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"rows" integer NOT NULL,
	"bytes" integer NOT NULL,
	CONSTRAINT "open_data_files_release_id_table_format_pk" PRIMARY KEY("release_id","table","format")
);
--> statement-breakpoint
CREATE TABLE "open_data_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fy" integer NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"national_report_id" uuid NOT NULL,
	"built_at" timestamp with time zone NOT NULL,
	"built_by" text,
	"published_at" timestamp with time zone,
	"published_by" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	"withdrawn_reason" text,
	"manifest_document_id" uuid,
	"verification_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_data_files" ADD CONSTRAINT "open_data_files_release_id_open_data_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."open_data_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_data_releases" ADD CONSTRAINT "open_data_releases_national_report_id_national_reports_id_fk" FOREIGN KEY ("national_report_id") REFERENCES "public"."national_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "open_data_releases_fy_kind_version_key" ON "open_data_releases" USING btree ("fy","kind","version");--> statement-breakpoint
-- Open-data releases are EACC's (`app.tenant` `eacc`), built from its national consolidated
-- report: EACC and platform read and write them (the public API reads as `platform`); a
-- Commission's context sees none of them.
ALTER TABLE "open_data_releases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "open_data_releases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "open_data_releases_eacc" ON "open_data_releases"
	USING (current_setting('app.tenant', true) IN ('eacc', 'platform'))
	WITH CHECK (current_setting('app.tenant', true) IN ('eacc', 'platform'));
--> statement-breakpoint
ALTER TABLE "open_data_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "open_data_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "open_data_files_eacc" ON "open_data_files"
	USING (current_setting('app.tenant', true) IN ('eacc', 'platform'))
	WITH CHECK (current_setting('app.tenant', true) IN ('eacc', 'platform'));
