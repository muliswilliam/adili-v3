-- Row-level security of the access database (ADR-006, ADR-018). FORCE applies the policies to the
-- service's own role, which owns the tables. Policies of one command are OR'ed.
--
-- Tenant axis: the Commission's context (`withTenant`, `app.tenant` = its slug) reads and writes its
-- rows; `platform` reads and writes every Commission's (the service's cross-Commission work).
--
-- Person axis (`withPerson`, `app.person`; a reset setting reads back as '' on a pooled connection,
-- hence nullif): the applicant reads their own requests; the declarant reads a request about them
-- once notified (a law enforcement request only once granted, r.23(2)), and writes their
-- representations on it (ADR-018 decision 5 style, as for declarants' drafts); the declarant reads
-- their own certified copies. Every other write (submission, register entries, decisions) runs in
-- the Commission's context, switched to within the same transaction when a person acted.
--
-- Law enforcement axis: a law enforcement officer (`app.tenant` `lea`) reads the requests they
-- filed (`app.subject` = `officer_subject`), across Commissions.
--
-- Register entries are visible to whoever may see the request they are about: the subquery is
-- itself under row-level security.
ALTER TABLE "access_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "access_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "access_requests_tenant_isolation" ON "access_requests"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "access_requests_person_read" ON "access_requests" FOR SELECT
	USING (
		"applicant_person_id" = nullif(current_setting('app.person', true), '')::uuid
		OR (
			"resolved_person_id" = nullif(current_setting('app.person', true), '')::uuid
			AND "notified_at" IS NOT NULL
		)
	);
--> statement-breakpoint
ALTER TABLE "representations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "representations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "representations_tenant_isolation" ON "representations"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "representations_person" ON "representations"
	USING (
		"person_id" = nullif(current_setting('app.person', true), '')::uuid
		AND EXISTS (
			SELECT 1 FROM "access_requests" r
			WHERE r."id" = "request_id"
				AND r."resolved_person_id" = nullif(current_setting('app.person', true), '')::uuid
				AND r."notified_at" IS NOT NULL
		)
	)
	WITH CHECK (
		"person_id" = nullif(current_setting('app.person', true), '')::uuid
		AND EXISTS (
			SELECT 1 FROM "access_requests" r
			WHERE r."id" = "request_id"
				AND r."tenant" = "representations"."tenant"
				AND r."resolved_person_id" = nullif(current_setting('app.person', true), '')::uuid
				AND r."notified_at" IS NOT NULL
		)
	);
--> statement-breakpoint
ALTER TABLE "lea_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lea_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lea_requests_tenant_isolation" ON "lea_requests"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "lea_requests_officer_read" ON "lea_requests" FOR SELECT
	USING (
		current_setting('app.tenant', true) = 'lea'
		AND "officer_subject" = nullif(current_setting('app.subject', true), '')
	);
--> statement-breakpoint
CREATE POLICY "lea_requests_person_read" ON "lea_requests" FOR SELECT
	USING (
		"resolved_person_id" = nullif(current_setting('app.person', true), '')::uuid
		AND "status" = 'granted'
	);
--> statement-breakpoint
ALTER TABLE "access_register" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "access_register" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "access_register_tenant_isolation" ON "access_register"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "access_register_subject_read" ON "access_register" FOR SELECT
	USING (
		("subject_kind" = 'access-request' AND EXISTS (SELECT 1 FROM "access_requests" r WHERE r."id" = "subject_id"))
		OR ("subject_kind" = 'lea-request' AND EXISTS (SELECT 1 FROM "lea_requests" l WHERE l."id" = "subject_id"))
		OR ("subject_kind" = 'self-access' AND "person_id" = nullif(current_setting('app.person', true), '')::uuid)
	);
--> statement-breakpoint
-- The register is append-only (ADR-008): an entry is never changed or removed.
CREATE FUNCTION "access_register_insert_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'access_register is insert-only: an entry cannot be updated or deleted'
		USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "access_register_insert_only" BEFORE UPDATE OR DELETE ON "access_register"
	FOR EACH ROW EXECUTE FUNCTION "access_register_insert_only"();
--> statement-breakpoint
ALTER TABLE "certified_copies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "certified_copies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "certified_copies_tenant_isolation" ON "certified_copies"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "certified_copies_person_read" ON "certified_copies" FOR SELECT
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "self_access_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "self_access_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "self_access_applications_tenant_isolation" ON "self_access_applications"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
