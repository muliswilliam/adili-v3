-- Issued documents and their verification records are the issuing Commission's data (ADR-006):
-- service transactions see their tenant's rows (`app.tenant`), platform work every tenant's.
-- The person a document is about reads it across Commissions (`withPerson`), never writes. A
-- reset setting reads back as '' on a pooled connection, hence nullif. FORCE applies the
-- policies to the service's own role, which owns the tables.
ALTER TABLE "issued_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "issued_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "issued_documents_tenant_isolation" ON "issued_documents"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "issued_documents_person_read" ON "issued_documents" FOR SELECT
	USING ("subject_person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "verification_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "verification_records_tenant_isolation" ON "verification_records"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- The records of the documents the person may read (the subquery is itself under RLS).
CREATE POLICY "verification_records_person_read" ON "verification_records" FOR SELECT
	USING (EXISTS (SELECT 1 FROM "issued_documents" d WHERE d."id" = "document_id"));
--> statement-breakpoint
-- What was issued never changes (ADR-010): its status lives on the verification record.
CREATE FUNCTION "issued_documents_insert_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'issued documents are insert-only' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "issued_documents_insert_only" BEFORE UPDATE OR DELETE ON "issued_documents"
	FOR EACH ROW EXECUTE FUNCTION "issued_documents_insert_only"();
