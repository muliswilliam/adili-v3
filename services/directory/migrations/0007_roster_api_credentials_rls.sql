-- A Commission's HR-system credential is tenant data (ADR-006), readable and writable only in
-- its own tenant's context. FORCE applies the policy to the owning role the service connects as.
ALTER TABLE "roster_api_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_api_credentials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roster_api_credentials_tenant_isolation" ON "roster_api_credentials"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
