ALTER TABLE "review_case_versions" ADD COLUMN "first_on_adili" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Versions whose no-previous-version flag is still on the case. An amended case's version 1 lost
-- that flag to the amendment, so it reads false until processed again.
UPDATE "review_case_versions" AS v SET "first_on_adili" = true
WHERE EXISTS (
  SELECT 1 FROM "review_flags" AS f
  WHERE f."case_id" = v."case_id" AND f."version_id" = v."version_id" AND f."rule_id" = 'no-previous-version'
);
