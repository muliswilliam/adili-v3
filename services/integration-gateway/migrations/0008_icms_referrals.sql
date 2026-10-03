CREATE TABLE "icms_referrals" (
	"referral_reference" text PRIMARY KEY NOT NULL,
	"referring_commission" text NOT NULL,
	"national_id_hash" text NOT NULL,
	"status" text NOT NULL,
	"case_number" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"requested_by" text NOT NULL,
	"legal_basis" text NOT NULL,
	"case_ref" text
);
