-- A verification result is tenant data (ADR-006 §5.3): the registry answer is encrypted under the
-- tenant it was looked up for, and that tenant's services read it back. Lookups for no tenant (IPRS
-- onboarding, ADR-014) keep no payload and are platform rows, as is the coverage across every
-- tenant. FORCE applies the policy to the service's own role, which owns the table.
ALTER TABLE "verification_results" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification_results" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "verification_results_tenant_isolation" ON "verification_results"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
