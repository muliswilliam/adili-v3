CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"person_id" uuid NOT NULL,
	"case_id" uuid,
	"cycle_year" integer NOT NULL,
	"grounds" text NOT NULL,
	"proposer_kind" text NOT NULL,
	"proposer" text,
	"proposer_name" text,
	"proposed_at" timestamp with time zone NOT NULL,
	"sources" jsonb NOT NULL,
	"narrative" text NOT NULL,
	"status" text NOT NULL,
	"approver" text,
	"approver_name" text,
	"approved_at" timestamp with time zone,
	"declined_by" text,
	"declined_by_name" text,
	"declined_at" timestamp with time zone,
	"decline_note" text,
	"reference" text,
	"package_manifest" jsonb,
	"package_document_id" uuid,
	"package_verification_id" text,
	"sent_at" timestamp with time zone,
	"declarant_name" text NOT NULL,
	"personnel_file_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_grounds_check" CHECK ("referrals"."grounds" in ('undeclared-assets', 'unexplained-assets', 'two-missed-cycles', 'unanswered-clarification')),
	CONSTRAINT "referrals_status_check" CHECK ("referrals"."status" in ('proposed', 'approved', 'declined', 'sent')),
	CONSTRAINT "referrals_proposer_kind_check" CHECK ("referrals"."proposer_kind" in ('system', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_reference_key" ON "referrals" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_system_proposal_key" ON "referrals" USING btree ("tenant","person_id","grounds","cycle_year") WHERE "referrals"."proposer_kind" = 'system';--> statement-breakpoint
CREATE INDEX "referrals_tenant_status_idx" ON "referrals" USING btree ("tenant","status","proposed_at");--> statement-breakpoint
CREATE INDEX "referrals_tenant_proposed_idx" ON "referrals" USING btree ("tenant","proposed_at","id");--> statement-breakpoint
CREATE INDEX "referrals_case_id_idx" ON "referrals" USING btree ("case_id");--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls). No person policy: the declarant
-- never reads a referral about them (spec 08).
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referrals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "referrals_tenant_isolation" ON "referrals"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
