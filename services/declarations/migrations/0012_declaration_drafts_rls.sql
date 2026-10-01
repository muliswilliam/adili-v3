-- Declarations and their sections and attachments are the declarant's (spec 05): a declarant
-- reads and writes their own through `app.person` (`withPerson`), across Commissions. A reset
-- setting reads back as '' on a pooled connection, hence nullif. Drafts are readable by nobody
-- else: the tenant policy, for staff reads in later slices, admits only declarations past the
-- draft, and no route of this slice reads through it. FORCE applies the policies to the service's
-- own role, which owns the tables.
ALTER TABLE "declarations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "declarations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "declarations_person" ON "declarations"
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid)
	WITH CHECK ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "declarations_tenant_read" ON "declarations" FOR SELECT
	USING (
		"status" NOT IN ('draft', 'discarded')
		AND ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	);
--> statement-breakpoint
ALTER TABLE "declaration_sections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "declaration_sections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "declaration_sections_person" ON "declaration_sections"
	USING (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	));
--> statement-breakpoint
-- The sections of the declarations the tenant may read (the subquery is itself under RLS).
CREATE POLICY "declaration_sections_tenant_read" ON "declaration_sections" FOR SELECT
	USING (
		nullif(current_setting('app.tenant', true), '') IS NOT NULL
		AND EXISTS (SELECT 1 FROM "declarations" d WHERE d."id" = "declaration_id")
	);
--> statement-breakpoint
ALTER TABLE "declaration_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "declaration_attachments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "declaration_attachments_person" ON "declaration_attachments"
	USING (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	));
--> statement-breakpoint
CREATE POLICY "declaration_attachments_tenant_read" ON "declaration_attachments" FOR SELECT
	USING (
		nullif(current_setting('app.tenant', true), '') IS NOT NULL
		AND EXISTS (SELECT 1 FROM "declarations" d WHERE d."id" = "declaration_id")
	);
