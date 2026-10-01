CREATE TABLE "approval_reassignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"to_supervisor" text NOT NULL,
	"to_supervisor_name" text,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_reassignments_subject_kind_check" CHECK ("approval_reassignments"."subject_kind" in ('determination', 'action', 'referral'))
);
--> statement-breakpoint
CREATE TABLE "determinations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reasons" text NOT NULL,
	"further_action_note" text,
	"proposer_kind" text NOT NULL,
	"proposer" text,
	"proposer_name" text,
	"proposed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"approver" text,
	"approver_name" text,
	"approved_at" timestamp with time zone,
	"returned_by" text,
	"returned_by_name" text,
	"returned_at" timestamp with time zone,
	"return_reason" text,
	"withdrawn_at" timestamp with time zone,
	"reference" text,
	"letter_document_id" uuid,
	"letter_verification_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "determinations_outcome_check" CHECK ("determinations"."outcome" in ('compliant', 'compliant-no-issues', 'non-compliant', 'further-action')),
	CONSTRAINT "determinations_status_check" CHECK ("determinations"."status" in ('proposed', 'approved', 'returned', 'withdrawn')),
	CONSTRAINT "determinations_proposer_kind_check" CHECK ("determinations"."proposer_kind" in ('system', 'user'))
);
--> statement-breakpoint
ALTER TABLE "determinations" ADD CONSTRAINT "determinations_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_reassignments_subject_idx" ON "approval_reassignments" USING btree ("subject_kind","subject_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "determinations_reference_key" ON "determinations" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "determinations_open_case_key" ON "determinations" USING btree ("case_id") WHERE "determinations"."status" in ('proposed', 'approved');--> statement-breakpoint
CREATE INDEX "determinations_case_id_idx" ON "determinations" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "determinations_tenant_status_idx" ON "determinations" USING btree ("tenant","status","proposed_at");--> statement-breakpoint
CREATE INDEX "determinations_person_status_idx" ON "determinations" USING btree ("person_id","status");--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls).
ALTER TABLE "determinations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "determinations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "determinations_tenant_isolation" ON "determinations"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "approval_reassignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approval_reassignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "approval_reassignments_tenant_isolation" ON "approval_reassignments"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- A declarant reads their own approved determinations across Commissions (`app.person`); a
-- proposal is the Commission's until it is approved.
CREATE POLICY "determinations_person_read" ON "determinations" FOR SELECT
	USING ("status" = 'approved' AND "person_id" = nullif(current_setting('app.person', true), '')::uuid);
