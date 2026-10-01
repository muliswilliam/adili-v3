-- Help articles are tenant data (ADR-006): a Commission's staff read and write their own
-- (`app.tenant`), platform work every Commission's and the platform's own (tenant null). Anyone
-- may read a published platform article. A declarant (`withPerson`) reads the published articles
-- of the Commissions they have filing obligations with (the subquery is itself under RLS, so it
-- sees only the person's obligations). The statutory corpus is public law with no tenant, so
-- `corpus_passages` and `corpus_imports` have no policies; only the import writes them. FORCE
-- applies the policies to the service's own role, which owns the tables.
ALTER TABLE "help_articles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "help_articles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "help_articles_tenant_isolation" ON "help_articles"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "help_articles_platform_read" ON "help_articles" FOR SELECT
	USING ("tenant" IS NULL AND "published");
--> statement-breakpoint
CREATE POLICY "help_articles_person_read" ON "help_articles" FOR SELECT
	USING (
		"published"
		AND EXISTS (SELECT 1 FROM "filing_obligations" o WHERE o."tenant" = "help_articles"."tenant")
	);
