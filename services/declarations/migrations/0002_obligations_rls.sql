-- Roster snapshots, obligations and reminders are tenant data (ADR-006): staff and system
-- transactions see their tenant's rows (`app.tenant`), platform work every tenant's. FORCE applies
-- the policies to the service's own role, which owns the tables.
ALTER TABLE "roster_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roster_snapshots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roster_snapshots_tenant_isolation" ON "roster_snapshots"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "filing_obligations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "filing_obligations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "filing_obligations_tenant_isolation" ON "filing_obligations"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- A declarant reads their own obligations across Commissions (`withPerson`), never writes. A reset
-- setting reads back as '' on a pooled connection, hence nullif.
CREATE POLICY "filing_obligations_person_read" ON "filing_obligations" FOR SELECT
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "obligation_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "obligation_reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "obligation_reminders_tenant_isolation" ON "obligation_reminders"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- The reminders of the obligations the person may read (the subquery is itself under RLS).
CREATE POLICY "obligation_reminders_person_read" ON "obligation_reminders" FOR SELECT
	USING (EXISTS (SELECT 1 FROM "filing_obligations" o WHERE o."id" = "obligation_id"));
--> statement-breakpoint
-- The biennial cycles: every two years from 2027, each opening 120 days before its statement date.
INSERT INTO "cycle_calendar" ("cycle_year", "opening_lead_days") VALUES (2027, 120), (2029, 120), (2031, 120);
