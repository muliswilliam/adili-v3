CREATE TABLE "reporting_entities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant" text NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_import_rows" (
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"tenant" text NOT NULL,
	"raw" jsonb NOT NULL,
	"normalised" jsonb,
	"status" text NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chunk_index" integer,
	"outcome" text,
	"applied_at" timestamp with time zone,
	"record_id" uuid,
	CONSTRAINT "roster_import_rows_import_id_row_number_pk" PRIMARY KEY("import_id","row_number"),
	CONSTRAINT "roster_import_rows_status_check" CHECK ("roster_import_rows"."status" in ('accepted', 'rejected')),
	CONSTRAINT "roster_import_rows_outcome_check" CHECK ("roster_import_rows"."outcome" is null or "roster_import_rows"."outcome" in ('created', 'updated', 'unchanged'))
);
--> statement-breakpoint
CREATE TABLE "roster_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant" text NOT NULL,
	"channel" text NOT NULL,
	"declared_complete" boolean NOT NULL,
	"upload_id" uuid,
	"file_name" text,
	"format" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer,
	"counts" jsonb,
	"mapping" jsonb,
	"failure_code" text,
	"failure_detail" text,
	"started_by_kind" text NOT NULL,
	"started_by" text NOT NULL,
	"started_by_name" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "roster_imports_channel_check" CHECK ("roster_imports"."channel" in ('file', 'api')),
	CONSTRAINT "roster_imports_format_check" CHECK ("roster_imports"."format" in ('csv', 'xlsx', 'json')),
	CONSTRAINT "roster_imports_state_check" CHECK ("roster_imports"."state" in ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "roster_imports_started_by_kind_check" CHECK ("roster_imports"."started_by_kind" in ('user', 'client')),
	CONSTRAINT "roster_imports_failure_check" CHECK (("roster_imports"."state" = 'failed') = ("roster_imports"."failure_code" is not null)),
	CONSTRAINT "roster_imports_completed_at_check" CHECK (("roster_imports"."state" in ('completed', 'failed')) = ("roster_imports"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "roster_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant" text NOT NULL,
	"personnel_file_number" text NOT NULL,
	"full_name" text NOT NULL,
	"national_id" text NOT NULL,
	"designation" text,
	"job_group" text,
	"reporting_entity_id" uuid,
	"appointment_date" date,
	"email" text,
	"phone" text,
	"state" text DEFAULT 'not_onboarded' NOT NULL,
	"exit_date" date,
	"absent_from_latest_import" boolean DEFAULT false NOT NULL,
	"flagged_by_import_id" uuid,
	"flagged_at" timestamp with time zone,
	"flag_cleared_by" text,
	"flag_cleared_at" timestamp with time zone,
	"source" text NOT NULL,
	"first_seen_import_id" uuid NOT NULL,
	"last_seen_import_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_records_state_check" CHECK ("roster_records"."state" in ('not_onboarded', 'onboarded', 'exited')),
	CONSTRAINT "roster_records_source_check" CHECK ("roster_records"."source" in ('file', 'api')),
	CONSTRAINT "roster_records_exit_date_check" CHECK ("roster_records"."state" = 'exited' or "roster_records"."exit_date" is null)
);
--> statement-breakpoint
CREATE TABLE "roster_summaries" (
	"tenant" text PRIMARY KEY NOT NULL,
	"expected" integer NOT NULL,
	"onboarded" integer NOT NULL,
	"flagged" integer NOT NULL,
	"last_import_id" uuid,
	"last_import_at" timestamp with time zone,
	"last_complete_import_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reporting_entities" ADD CONSTRAINT "reporting_entities_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_import_rows" ADD CONSTRAINT "roster_import_rows_import_id_roster_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."roster_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_import_rows" ADD CONSTRAINT "roster_import_rows_record_id_roster_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."roster_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_imports" ADD CONSTRAINT "roster_imports_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_records" ADD CONSTRAINT "roster_records_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_records" ADD CONSTRAINT "roster_records_reporting_entity_id_reporting_entities_id_fk" FOREIGN KEY ("reporting_entity_id") REFERENCES "public"."reporting_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_records" ADD CONSTRAINT "roster_records_flagged_by_import_id_roster_imports_id_fk" FOREIGN KEY ("flagged_by_import_id") REFERENCES "public"."roster_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_records" ADD CONSTRAINT "roster_records_first_seen_import_id_roster_imports_id_fk" FOREIGN KEY ("first_seen_import_id") REFERENCES "public"."roster_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_records" ADD CONSTRAINT "roster_records_last_seen_import_id_roster_imports_id_fk" FOREIGN KEY ("last_seen_import_id") REFERENCES "public"."roster_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_summaries" ADD CONSTRAINT "roster_summaries_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_summaries" ADD CONSTRAINT "roster_summaries_last_import_id_roster_imports_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "public"."roster_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_entities_tenant_normalised_name_key" ON "reporting_entities" USING btree ("tenant","normalised_name");--> statement-breakpoint
CREATE INDEX "roster_import_rows_import_id_status_idx" ON "roster_import_rows" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "roster_import_rows_import_id_chunk_index_idx" ON "roster_import_rows" USING btree ("import_id","chunk_index");--> statement-breakpoint
CREATE INDEX "roster_imports_tenant_started_at_idx" ON "roster_imports" USING btree ("tenant","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "roster_imports_one_in_progress_key" ON "roster_imports" USING btree ("tenant") WHERE "roster_imports"."state" in ('pending', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "roster_records_tenant_file_number_key" ON "roster_records" USING btree ("tenant",lower("personnel_file_number"));--> statement-breakpoint
CREATE INDEX "roster_records_tenant_national_id_idx" ON "roster_records" USING btree ("tenant","national_id");--> statement-breakpoint
CREATE INDEX "roster_records_tenant_state_idx" ON "roster_records" USING btree ("tenant","state");--> statement-breakpoint
CREATE INDEX "roster_records_tenant_flagged_idx" ON "roster_records" USING btree ("tenant") WHERE "roster_records"."absent_from_latest_import";--> statement-breakpoint
CREATE INDEX "roster_records_last_seen_import_id_idx" ON "roster_records" USING btree ("last_seen_import_id");