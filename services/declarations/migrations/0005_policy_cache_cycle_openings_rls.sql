-- The policy cache and the cycle openings are rows about one tenant (ADR-006 §5.3): tenant-scoped
-- like the snapshots and obligations (0002). Staff and system transactions see their tenant's rows
-- (`app.tenant`), platform work (the national summary, the sweep, schedules on start-up) every
-- tenant's. FORCE applies the policies to the service's own role, which owns the tables.
ALTER TABLE "tenant_policy_cache" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_policy_cache" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_policy_cache_tenant_isolation" ON "tenant_policy_cache"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "cycle_openings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cycle_openings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "cycle_openings_tenant_isolation" ON "cycle_openings"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
