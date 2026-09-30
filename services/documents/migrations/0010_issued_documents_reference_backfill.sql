-- Documents issued before 0009 carry their reference number only in the public payload of their
-- verification record. What was issued is insert-only (0006); this one-off backfill of the new
-- column is the exception, with the trigger off for the statement. It runs as platform work: the
-- tables are under FORCE row-level security (0006).
SELECT set_config('app.tenant', 'platform', true);
--> statement-breakpoint
ALTER TABLE "issued_documents" DISABLE TRIGGER "issued_documents_insert_only";
--> statement-breakpoint
UPDATE "issued_documents" d SET "reference" = r."public_payload"->>'reference'
	FROM "verification_records" r
	WHERE r."document_id" = d."id" AND d."reference" IS NULL;
--> statement-breakpoint
ALTER TABLE "issued_documents" ENABLE TRIGGER "issued_documents_insert_only";
