CREATE TABLE "compliance_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"fy" integer NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'hosted' NOT NULL,
	"reference" text,
	"compile_requested_at" timestamp with time zone,
	"compiled_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"confirmed_by" text,
	"confirmed_by_name" text,
	"confirmed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"late" boolean,
	"snapshot_ciphertext" text,
	"envelope" jsonb,
	"canonical_sha256" text,
	"counts" jsonb,
	"form_m_document_id" uuid,
	"receipt_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_remarks" (
	"report_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"obligation_id" uuid NOT NULL,
	"remark" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_remarks_report_id_obligation_id_pk" PRIMARY KEY("report_id","obligation_id")
);
--> statement-breakpoint
CREATE TABLE "action_facts" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone,
	"complied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clarification_facts" (
	"clarification_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"fy" integer,
	"issued_at" timestamp with time zone,
	"status" text NOT NULL,
	"status_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "determination_facts" (
	"determination_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"fy" integer NOT NULL,
	"approved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligation_facts" (
	"obligation_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"roster_record_id" uuid,
	"type" text,
	"cycle_key" text,
	"fy" integer,
	"statement_date" date,
	"due_date" date,
	"status" text,
	"status_at" timestamp with time zone,
	"filed_at" timestamp with time zone,
	"late" boolean
);
--> statement-breakpoint
CREATE TABLE "referral_facts" (
	"referral_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"reference" text NOT NULL,
	"grounds" text NOT NULL,
	"fy" integer NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_remarks" ADD CONSTRAINT "report_remarks_report_id_compliance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."compliance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_reports_tenant_fy_key" ON "compliance_reports" USING btree ("tenant","fy");--> statement-breakpoint
CREATE INDEX "action_facts_subject_idx" ON "action_facts" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "clarification_facts_tenant_fy_idx" ON "clarification_facts" USING btree ("tenant","fy");--> statement-breakpoint
CREATE INDEX "obligation_facts_tenant_fy_idx" ON "obligation_facts" USING btree ("tenant","fy");