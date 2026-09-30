-- ADR-018 §2: the person axis is FOR SELECT only; declarants never write through it. Migration
-- 0016 gave the declarant's `app.person` every command on their versions and items; they now only
-- read them there. The submit transaction writes the version and its items in the Commission's
-- context (`app.tenant`, switched to the declaration's tenant after the declarant's own rows are
-- checked), and the acknowledgement follows the legal act there or as `platform`, as before.
DROP POLICY "declaration_versions_person" ON "declaration_versions";
--> statement-breakpoint
CREATE POLICY "declaration_versions_person_read" ON "declaration_versions" FOR SELECT
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "declaration_versions_tenant_insert" ON "declaration_versions" FOR INSERT
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
DROP POLICY "declaration_items_person" ON "declaration_items";
--> statement-breakpoint
-- The items of the versions the person may read (the subquery is itself under RLS).
CREATE POLICY "declaration_items_person_read" ON "declaration_items" FOR SELECT
	USING (EXISTS (
		SELECT 1 FROM "declaration_versions" v
		WHERE v."id" = "declaration_items"."version_id" AND v."cycle_year" = "declaration_items"."cycle_year"
			AND v."person_id" = nullif(current_setting('app.person', true), '')::uuid
	));
--> statement-breakpoint
CREATE POLICY "declaration_items_tenant_insert" ON "declaration_items" FOR INSERT
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
