ALTER TABLE "review_case_versions" ADD COLUMN "first_on_adili" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The backfill runs as platform work: the tables are under FORCE row-level security (0002, 0003)
-- and no tenant is set while migrating, so without it the update would see no rows.
SELECT set_config('app.tenant', 'platform', true);--> statement-breakpoint
-- A version had no earlier declaration on Adili to compare with when its no-previous-version flag
-- is still on the case, or, as an amendment replaced version 1's unreviewed flags, when it is a
-- version 1 submitted before any other version of the person at the Commission.
UPDATE "review_case_versions" AS v SET "first_on_adili" = true
WHERE EXISTS (
  SELECT 1 FROM "review_flags" AS f
  WHERE f."case_id" = v."case_id" AND f."version_id" = v."version_id" AND f."rule_id" = 'no-previous-version'
) OR (
  v."version" = 1 AND NOT EXISTS (
    SELECT 1 FROM "review_case_versions" AS earlier
    JOIN "review_cases" AS earlier_case ON earlier_case."id" = earlier."case_id"
    JOIN "review_cases" AS c ON c."id" = v."case_id"
    WHERE earlier_case."tenant" = c."tenant" AND earlier_case."person_id" = c."person_id"
      AND earlier."case_id" <> v."case_id" AND earlier."submitted_at" < v."submitted_at"
  )
);
