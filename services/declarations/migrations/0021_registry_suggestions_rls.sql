-- Registry suggestions (spec 05b) are the declarant's, like the draft they belong to: read and
-- written through `app.person` (`withPerson`) by way of their declaration, as the draft's sections
-- are (0012). Unlike sections there is no tenant read: suggestions never leave the draft, and no
-- staff route reads them. FORCE applies the policies to the service's own role, which owns the
-- tables.
ALTER TABLE "suggestion_consents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "suggestion_consents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "suggestion_consents_person" ON "suggestion_consents"
	USING (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	));
--> statement-breakpoint
ALTER TABLE "suggestion_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "suggestion_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "suggestion_sets_person" ON "suggestion_sets"
	USING (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	));
--> statement-breakpoint
ALTER TABLE "suggestions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "suggestions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "suggestions_person" ON "suggestions"
	USING (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "declarations" d
		WHERE d."id" = "declaration_id" AND d."person_id" = nullif(current_setting('app.person', true), '')::uuid
	));
