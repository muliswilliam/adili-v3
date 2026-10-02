-- The reason a declarant gives for dismissing a suggestion is their own words: sealed with the
-- Commission's key like the suggestion's contents (SuggestionCipher.sealReason), never in clear.
-- A reason stored in clear before this cannot be sealed in SQL; it is dropped (spec 05b had not
-- shipped).
ALTER TABLE "suggestions" ADD COLUMN "reason_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "reason_envelope" jsonb;--> statement-breakpoint
ALTER TABLE "suggestions" DROP COLUMN "reason";