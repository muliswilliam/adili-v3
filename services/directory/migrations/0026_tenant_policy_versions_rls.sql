-- A Commission's policy versions are tenant configuration (ADR-006 §5.3, §8): its staff read their
-- own, platform work (Commission creation, the demo seed, platform admins) every tenant's. FORCE
-- applies the policy to the service's own role, which owns the table.
ALTER TABLE "tenant_policy_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_policy_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_policy_versions_tenant_isolation" ON "tenant_policy_versions"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
