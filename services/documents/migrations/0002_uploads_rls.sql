-- Uploads are tenant data (ADR-006). FORCE applies the policy to the owning role the service
-- connects as. `platform` is the context of platform-wide work (the expiry sweep).
ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "uploads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "uploads_tenant_isolation" ON "uploads"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
