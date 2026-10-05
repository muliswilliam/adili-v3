-- Ask Adili's question counts (spec 11 S8) are tenant data (ADR-006): a Commission's staff read
-- their own (`app.tenant`), the platform every Commission's. They are counted as each answer is
-- stored, in the declarant's transaction (`app.person`), which may count, and read back for its
-- upsert, only at the Commissions the person has filing obligations with (the subquery is itself
-- under RLS, so it sees only the person's obligations), never delete. The person policies hold
-- only in a person transaction: a staff one sees its tenant's obligations, and must not count
-- through them. FORCE applies the policies
-- to the service's own role, which owns the table.
ALTER TABLE "assistant_theme_counts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assistant_theme_counts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "assistant_theme_counts_tenant_read" ON "assistant_theme_counts" FOR SELECT
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "assistant_theme_counts_person_read" ON "assistant_theme_counts" FOR SELECT
	USING (nullif(current_setting('app.person', true), '') IS NOT NULL AND EXISTS (SELECT 1 FROM "filing_obligations" o WHERE o."tenant" = "assistant_theme_counts"."tenant"));
--> statement-breakpoint
CREATE POLICY "assistant_theme_counts_person_insert" ON "assistant_theme_counts" FOR INSERT
	WITH CHECK (nullif(current_setting('app.person', true), '') IS NOT NULL AND EXISTS (SELECT 1 FROM "filing_obligations" o WHERE o."tenant" = "assistant_theme_counts"."tenant"));
--> statement-breakpoint
CREATE POLICY "assistant_theme_counts_person_update" ON "assistant_theme_counts" FOR UPDATE
	USING (nullif(current_setting('app.person', true), '') IS NOT NULL AND EXISTS (SELECT 1 FROM "filing_obligations" o WHERE o."tenant" = "assistant_theme_counts"."tenant"))
	WITH CHECK (nullif(current_setting('app.person', true), '') IS NOT NULL AND EXISTS (SELECT 1 FROM "filing_obligations" o WHERE o."tenant" = "assistant_theme_counts"."tenant"));
--> statement-breakpoint
-- The summary hints cache is deliberately shared across Commissions: its key is a hash of the
-- declaration type, the household as counts and the residuals (rule ids and field paths, persons
-- by their place), and its value plain-language guidance, so it holds no tenant's data and
-- nothing personal. Two declarants of different Commissions with the same residuals get the same
-- hints from one job, which the national filing peak needs. No RLS, by design.
COMMENT ON TABLE "assistant_hint_cache" IS 'Platform-level, no RLS: summary hints by residual set hash, language and prompt version; nothing personal. See migration 0025.';
