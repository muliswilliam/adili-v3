-- Packages issued before 0009 are access packages. 0009's backfill ran with no tenant set, so
-- FORCE row-level security (0002, 0004) hid every row from it and it updated none. The backfill
-- runs as platform work.
SELECT set_config('app.tenant', 'platform', true);
--> statement-breakpoint
UPDATE "lea_requests" SET "package_kind" = 'access-package'
	WHERE "package_document_id" IS NOT NULL AND "package_kind" IS NULL;
--> statement-breakpoint
UPDATE "access_requests" SET "package_kind" = 'access-package'
	WHERE "package_document_id" IS NOT NULL AND "package_kind" IS NULL;
--> statement-breakpoint
-- The migrations after this one run in the same transaction (drizzle's migrator runs them all in
-- one): they must not inherit the platform setting.
SELECT set_config('app.tenant', '', true);
