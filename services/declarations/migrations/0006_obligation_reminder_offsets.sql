-- Each obligation keeps the reminder offsets of the policy version it was created under, so its
-- workflow never plans with a later version's (ADR-003 §4). Existing obligations get their
-- Commission's cached offsets (the version in force when they were created, as no policy change
-- was consumed before this), else the platform default. The backfill runs as platform work: the
-- tables are under FORCE row-level security (0002, 0005).
SELECT set_config('app.tenant', 'platform', true);
--> statement-breakpoint
ALTER TABLE "filing_obligations" ADD COLUMN "reminder_offsets_days" integer[];
--> statement-breakpoint
UPDATE "filing_obligations" AS "obligation"
	SET "reminder_offsets_days" = coalesce(
		(SELECT array_agg("offset"::int ORDER BY "offset"::int DESC)
			FROM "tenant_policy_cache" AS "cache",
				jsonb_array_elements_text("cache"."policy" -> 'reminderOffsetsDays') AS "offset"
			WHERE "cache"."tenant" = "obligation"."tenant"),
		'{30,14,7}'::integer[]);
--> statement-breakpoint
ALTER TABLE "filing_obligations" ALTER COLUMN "reminder_offsets_days" SET NOT NULL;
