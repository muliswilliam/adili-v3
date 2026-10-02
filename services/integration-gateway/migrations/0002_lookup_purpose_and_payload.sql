ALTER TABLE "verification_results" ADD COLUMN "tenant" text;--> statement-breakpoint
-- Every row so far is an IPRS lookup made for onboarding (ADR-014).
ALTER TABLE "verification_results" ADD COLUMN "legal_basis" text DEFAULT 'adr-014-onboarding' NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_results" ALTER COLUMN "legal_basis" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "verification_results" ADD COLUMN "case_ref" text;--> statement-breakpoint
ALTER TABLE "verification_results" ADD COLUMN "payload_ciphertext" text;--> statement-breakpoint
ALTER TABLE "verification_results" ADD COLUMN "payload_envelope" jsonb;