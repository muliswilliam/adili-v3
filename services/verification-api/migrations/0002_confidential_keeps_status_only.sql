-- A confidential document's row keeps its status only (ADR-010 §2): drop the hash and revocation
-- reason already projected, so the tightened check in the next migration holds.
ALTER TABLE "verification_projection" ALTER COLUMN "sha256" DROP NOT NULL;--> statement-breakpoint
UPDATE "verification_projection" SET "sha256" = NULL, "revoked_reason" = NULL WHERE "disclosure_level" = 'confidential';
