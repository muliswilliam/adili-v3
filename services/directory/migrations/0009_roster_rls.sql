-- The roster is tenant data (ADR-006): each table is readable and writable only in its own
-- tenant's context. FORCE applies the policies to the owning role the service connects as.
-- `platform` is the context of platform-wide principals (platform admin, EACC analysts and
-- supervisors, see tenantContextOf); which of them may read records rather than only summaries
-- and imports is decided in the service (spec #27 authorisation matrix). Import activities run
-- in the importing tenant's context.
ALTER TABLE "reporting_entities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reporting_entities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "reporting_entities_tenant_isolation" ON "reporting_entities"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "roster_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roster_records_tenant_isolation" ON "roster_records"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "roster_imports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_imports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roster_imports_tenant_isolation" ON "roster_imports"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "roster_import_rows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_import_rows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roster_import_rows_tenant_isolation" ON "roster_import_rows"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "roster_summaries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_summaries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roster_summaries_tenant_isolation" ON "roster_summaries"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
