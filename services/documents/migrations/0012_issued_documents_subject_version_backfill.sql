-- Documents issued before 0011 carry the version of what they are about only in the public
-- payload of their verification record (null for a confidential document, which has none). What
-- was issued is insert-only (0006); this one-off backfill of the new column is the exception, as
-- in 0010, with the trigger off for the statement. It runs as platform work: the tables are
-- under FORCE row-level security (0006).
SELECT set_config('app.tenant', 'platform', true);
--> statement-breakpoint
ALTER TABLE "issued_documents" DISABLE TRIGGER "issued_documents_insert_only";
--> statement-breakpoint
UPDATE "issued_documents" d SET "subject_version" = (r."public_payload"->>'version')::integer
	FROM "verification_records" r
	WHERE r."document_id" = d."id" AND d."subject_version" IS NULL
		AND jsonb_typeof(r."public_payload"->'version') = 'number';
--> statement-breakpoint
ALTER TABLE "issued_documents" ENABLE TRIGGER "issued_documents_insert_only";
