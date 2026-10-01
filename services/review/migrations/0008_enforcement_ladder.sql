CREATE TABLE "administrative_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"ladder_id" uuid NOT NULL,
	"run" integer NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"person_id" uuid,
	"roster_record_id" uuid,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"proposer_kind" text NOT NULL,
	"proposer" text,
	"proposer_name" text,
	"proposed_at" timestamp with time zone NOT NULL,
	"approver" text,
	"approver_name" text,
	"approved_at" timestamp with time zone,
	"declined_by" text,
	"declined_by_name" text,
	"declined_at" timestamp with time zone,
	"decline_note" text,
	"issued_at" timestamp with time zone,
	"window_ends_at" timestamp with time zone,
	"reference" text,
	"letter_document_id" uuid,
	"letter_verification_id" text,
	"response" jsonb,
	"responded_at" timestamp with time zone,
	"complied_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"payroll_stop_reference" text,
	"payroll_stop_ack" jsonb,
	"payroll_resume_reference" text,
	"payroll_resume_ack" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "administrative_actions_subject_kind_check" CHECK ("administrative_actions"."subject_kind" in ('obligation', 'clarification')),
	CONSTRAINT "administrative_actions_step_check" CHECK ("administrative_actions"."step" in ('notice-to-comply', 'warning', 'salary-stoppage', 'disciplinary-referral')),
	CONSTRAINT "administrative_actions_status_check" CHECK ("administrative_actions"."status" in ('proposed', 'approved', 'approved-pending-payroll', 'declined', 'issued', 'responded', 'complied', 'reinstated', 'cancelled')),
	CONSTRAINT "administrative_actions_proposer_kind_check" CHECK ("administrative_actions"."proposer_kind" in ('system', 'user'))
);
--> statement-breakpoint
CREATE TABLE "enforcement_ladders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"person_id" uuid,
	"roster_record_id" uuid,
	"case_id" uuid,
	"subject_reference" text NOT NULL,
	"declarant_name" text NOT NULL,
	"personnel_file_number" text NOT NULL,
	"status" text NOT NULL,
	"current_action_id" uuid,
	"run" integer DEFAULT 1 NOT NULL,
	"closing_cause" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enforcement_ladders_subject_kind_check" CHECK ("enforcement_ladders"."subject_kind" in ('obligation', 'clarification')),
	CONSTRAINT "enforcement_ladders_status_check" CHECK ("enforcement_ladders"."status" in ('active', 'complied', 'declined', 'ended')),
	CONSTRAINT "enforcement_ladders_closing_cause_check" CHECK ("enforcement_ladders"."closing_cause" is null or "enforcement_ladders"."closing_cause" in ('filed', 'clarification-responded', 'clarification-resolved', 'obligation-cancelled', 'clarification-withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "ladder_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"ladder_id" uuid NOT NULL,
	"action_id" uuid,
	"kind" text NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "ladder_history_kind_check" CHECK ("ladder_history"."kind" in ('ladder-started', 'ladder-restarted', 'ladder-complied', 'ladder-ended', 'action-proposed', 'action-approved', 'action-declined', 'action-issued', 'action-responded', 'action-complied', 'action-cancelled'))
);
--> statement-breakpoint
ALTER TABLE "administrative_actions" ADD CONSTRAINT "administrative_actions_ladder_id_enforcement_ladders_id_fk" FOREIGN KEY ("ladder_id") REFERENCES "public"."enforcement_ladders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ladder_history" ADD CONSTRAINT "ladder_history_ladder_id_enforcement_ladders_id_fk" FOREIGN KEY ("ladder_id") REFERENCES "public"."enforcement_ladders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "administrative_actions_reference_key" ON "administrative_actions" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "administrative_actions_proposed_ladder_key" ON "administrative_actions" USING btree ("ladder_id") WHERE "administrative_actions"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "administrative_actions_ladder_idx" ON "administrative_actions" USING btree ("ladder_id","proposed_at");--> statement-breakpoint
CREATE INDEX "administrative_actions_tenant_status_idx" ON "administrative_actions" USING btree ("tenant","status","proposed_at");--> statement-breakpoint
CREATE INDEX "administrative_actions_person_idx" ON "administrative_actions" USING btree ("person_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "enforcement_ladders_subject_key" ON "enforcement_ladders" USING btree ("tenant","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "enforcement_ladders_tenant_started_idx" ON "enforcement_ladders" USING btree ("tenant","started_at","id");--> statement-breakpoint
CREATE INDEX "ladder_history_ladder_idx" ON "ladder_history" USING btree ("ladder_id","at");
--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls).
ALTER TABLE "enforcement_ladders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "enforcement_ladders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "enforcement_ladders_tenant_isolation" ON "enforcement_ladders"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls).
ALTER TABLE "administrative_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "administrative_actions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "administrative_actions_tenant_isolation" ON "administrative_actions"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls).
ALTER TABLE "ladder_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ladder_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ladder_history_tenant_isolation" ON "ladder_history"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- A declarant reads their own steps that have gone to them, across Commissions (`app.person`);
-- a draft, or a step approved but not yet sent, is the Commission's.
CREATE POLICY "administrative_actions_person_read" ON "administrative_actions" FOR SELECT
	USING ("status" in ('issued', 'responded', 'complied', 'reinstated') AND "issued_at" IS NOT NULL AND "person_id" = nullif(current_setting('app.person', true), '')::uuid);
