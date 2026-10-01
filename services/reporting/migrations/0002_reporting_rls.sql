-- Facts and compliance reports are tenant data (ADR-006): staff and system transactions see their
-- tenant's rows (`app.tenant`), platform work every tenant's. FORCE applies the policies to the
-- service's own role, which owns the tables.
ALTER TABLE "obligation_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "obligation_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "obligation_facts_tenant_isolation" ON "obligation_facts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "clarification_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clarification_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "clarification_facts_tenant_isolation" ON "clarification_facts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "action_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "action_facts_tenant_isolation" ON "action_facts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "determination_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "determination_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "determination_facts_tenant_isolation" ON "determination_facts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "referral_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referral_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "referral_facts_tenant_isolation" ON "referral_facts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "compliance_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "compliance_reports_tenant_isolation" ON "compliance_reports"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "report_remarks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_remarks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "report_remarks_tenant_isolation" ON "report_remarks"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
