CREATE TABLE "clarification_responses" (
	"clarification_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"person_id" uuid NOT NULL,
	"items" jsonb NOT NULL,
	"attachments" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clarifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"reference" text,
	"status" text NOT NULL,
	"items" jsonb NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"response_late" boolean,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"letter_document_id" uuid,
	"letter_verification_id" text,
	"follow_up_of" uuid,
	"withdrawn_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clarifications_status_check" CHECK ("clarifications"."status" in ('draft', 'issued', 'responded', 'resolved', 'overdue', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "review_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"subject" text,
	"subject_name" text,
	"kind" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_assignments_kind_check" CHECK ("review_assignments"."kind" in ('claimed', 'released', 'reassigned', 'unassigned'))
);
--> statement-breakpoint
CREATE TABLE "review_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"declaration_id" uuid NOT NULL,
	"current_version_id" uuid NOT NULL,
	"current_version" integer NOT NULL,
	"person_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"type" text NOT NULL,
	"statement_date" date NOT NULL,
	"cycle_year" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"late" boolean NOT NULL,
	"score" integer NOT NULL,
	"band" text NOT NULL,
	"status" text NOT NULL,
	"assignee" text,
	"assignee_name" text,
	"claimed_at" timestamp with time zone,
	"declarant_name" text NOT NULL,
	"personnel_file_number" text NOT NULL,
	"open_flags" integer DEFAULT 0 NOT NULL,
	"open_clarifications" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_cases_type_check" CHECK ("review_cases"."type" in ('initial', 'biennial', 'final')),
	CONSTRAINT "review_cases_band_check" CHECK ("review_cases"."band" in ('low', 'medium', 'high')),
	CONSTRAINT "review_cases_status_check" CHECK ("review_cases"."status" in ('unassigned', 'assigned', 'awaiting-clarification', 'clarified', 'ready-for-determination', 'sample-review', 'further-action', 'determined'))
);
--> statement-breakpoint
CREATE TABLE "review_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"indicator" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"item_refs" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_note" text,
	"recomputed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_flags_severity_check" CHECK ("review_flags"."severity" in ('info', 'low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "review_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"author" text NOT NULL,
	"author_name" text,
	"text" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_timeline" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"actor" text NOT NULL,
	"summary" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clarification_responses" ADD CONSTRAINT "clarification_responses_clarification_id_clarifications_id_fk" FOREIGN KEY ("clarification_id") REFERENCES "public"."clarifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_timeline" ADD CONSTRAINT "review_timeline_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clarifications_reference_key" ON "clarifications" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "clarifications_case_id_idx" ON "clarifications" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "clarifications_person_status_idx" ON "clarifications" USING btree ("person_id","status");--> statement-breakpoint
CREATE INDEX "clarifications_tenant_status_idx" ON "clarifications" USING btree ("tenant","status");--> statement-breakpoint
CREATE INDEX "review_assignments_case_id_idx" ON "review_assignments" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_cases_declaration_id_key" ON "review_cases" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "review_cases_queue_idx" ON "review_cases" USING btree ("tenant","status","score" DESC NULLS LAST,"received_at");--> statement-breakpoint
CREATE INDEX "review_cases_tenant_score_idx" ON "review_cases" USING btree ("tenant","score" DESC NULLS LAST,"received_at","id");--> statement-breakpoint
CREATE INDEX "review_cases_tenant_assignee_idx" ON "review_cases" USING btree ("tenant","assignee");--> statement-breakpoint
CREATE INDEX "review_flags_case_id_idx" ON "review_flags" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "review_notes_case_id_idx" ON "review_notes" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "review_timeline_case_id_at_idx" ON "review_timeline" USING btree ("case_id","at");