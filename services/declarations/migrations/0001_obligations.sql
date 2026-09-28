CREATE TABLE "commission_refs" (
	"slug" text PRIMARY KEY NOT NULL,
	"issuer_code" text NOT NULL,
	"name" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_calendar" (
	"cycle_year" integer PRIMARY KEY NOT NULL,
	"opening_lead_days" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filing_obligations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"roster_record_id" uuid NOT NULL,
	"person_id" uuid,
	"ofr" text,
	"type" text NOT NULL,
	"cycle_key" text NOT NULL,
	"statement_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text NOT NULL,
	"cancel_reason" text,
	"policy_version_id" uuid NOT NULL,
	"policy_version" integer NOT NULL,
	"workflow_started_at" timestamp with time zone,
	"filed_declaration_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filing_obligations_type_check" CHECK ("filing_obligations"."type" in ('initial', 'biennial', 'final')),
	CONSTRAINT "filing_obligations_status_check" CHECK ("filing_obligations"."status" in ('upcoming', 'due', 'overdue', 'filed', 'cancelled')),
	CONSTRAINT "filing_obligations_cancel_reason_check" CHECK (("filing_obligations"."status" = 'cancelled') = ("filing_obligations"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "obligation_reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"obligation_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"offset_days" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligation_reminders_obligation_offset_key" UNIQUE("obligation_id","offset_days"),
	CONSTRAINT "obligation_reminders_outcome_check" CHECK ("obligation_reminders"."outcome" in ('sent', 'skipped-not-onboarded', 'skipped-no-contact', 'skipped-past-due-at-creation', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "roster_snapshots" (
	"roster_record_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"personnel_file_number" text NOT NULL,
	"full_name" text NOT NULL,
	"state" text NOT NULL,
	"appointment_date" date,
	"exit_date" date,
	"person_id" uuid,
	"ofr" text,
	"onboarded_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone NOT NULL,
	"synced_from" uuid,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_snapshots_state_check" CHECK ("roster_snapshots"."state" in ('active', 'exited'))
);
--> statement-breakpoint
CREATE TABLE "tenant_policy_cache" (
	"tenant" text PRIMARY KEY NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filing_obligations" ADD CONSTRAINT "filing_obligations_roster_record_id_roster_snapshots_roster_record_id_fk" FOREIGN KEY ("roster_record_id") REFERENCES "public"."roster_snapshots"("roster_record_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_reminders" ADD CONSTRAINT "obligation_reminders_obligation_id_filing_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."filing_obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "filing_obligations_live_cycle_key" ON "filing_obligations" USING btree ("roster_record_id","cycle_key") WHERE "filing_obligations"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "filing_obligations_tenant_status_due_idx" ON "filing_obligations" USING btree ("tenant","status","due_date");--> statement-breakpoint
CREATE INDEX "filing_obligations_person_id_idx" ON "filing_obligations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "filing_obligations_roster_record_id_idx" ON "filing_obligations" USING btree ("roster_record_id");--> statement-breakpoint
CREATE INDEX "roster_snapshots_tenant_state_idx" ON "roster_snapshots" USING btree ("tenant","state");--> statement-breakpoint
CREATE INDEX "roster_snapshots_person_id_idx" ON "roster_snapshots" USING btree ("person_id");