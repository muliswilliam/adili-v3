-- An HR system's pushed batch holds its raw rows (personal data) until staging and is tenant
-- data (ADR-006) like the other roster tables (0009): readable and writable only in its own
-- tenant's context. FORCE applies the policy to the owning role the service connects as.
ALTER TABLE "roster_import_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_import_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roster_import_batches_tenant_isolation" ON "roster_import_batches"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
