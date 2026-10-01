CREATE TABLE "referral_intake" (
	"referral_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"reference" text NOT NULL,
	"grounds" text NOT NULL,
	"cycle_year" integer NOT NULL,
	"package_document_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"icms_status" text DEFAULT 'not-pushed' NOT NULL,
	"icms_case_number" text,
	"icms_registered_at" timestamp with time zone,
	"push_attempts" integer DEFAULT 0 NOT NULL,
	"pushed_at" timestamp with time zone,
	"pushed_by" text,
	"pushed_by_name" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "referral_intake_sent_idx" ON "referral_intake" USING btree ("sent_at","referral_id");--> statement-breakpoint
CREATE INDEX "referral_intake_status_idx" ON "referral_intake" USING btree ("icms_status","sent_at","referral_id");--> statement-breakpoint
-- EACC's referrals intake: the Commission's context takes in its own referrals (the inbox
-- consumer of `referral.sent.v1`); EACC (`app.tenant` `eacc`) and platform read and update every
-- Commission's as they push them to ICMS.
ALTER TABLE "referral_intake" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referral_intake" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "referral_intake_tenant_or_eacc" ON "referral_intake"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) IN ('platform', 'eacc'))
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) IN ('platform', 'eacc'));
