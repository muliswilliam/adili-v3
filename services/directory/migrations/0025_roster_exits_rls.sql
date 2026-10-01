-- Exits are tenant data (ADR-006), under the roster's policy (0009).
ALTER TABLE "roster_exits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_exits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roster_exits_tenant_isolation" ON "roster_exits"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
