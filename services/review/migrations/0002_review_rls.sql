-- Review cases, flags, assignments, clarifications, responses, notes and the timeline are tenant
-- data (ADR-006): staff and system transactions see their tenant's rows (`app.tenant`), platform
-- work every tenant's. FORCE applies the policies to the service's own role, which owns the tables.
ALTER TABLE "review_cases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_cases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_cases_tenant_isolation" ON "review_cases"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "review_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_assignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_assignments_tenant_isolation" ON "review_assignments"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "review_flags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_flags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_flags_tenant_isolation" ON "review_flags"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "clarifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clarifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "clarifications_tenant_isolation" ON "clarifications"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "clarification_responses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clarification_responses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "clarification_responses_tenant_isolation" ON "clarification_responses"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "review_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_notes_tenant_isolation" ON "review_notes"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "review_timeline" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_timeline" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_timeline_tenant_isolation" ON "review_timeline"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- A declarant reads their own clarifications and responses across Commissions (`app.person`). A
-- reset setting reads back as '' on a pooled connection, hence nullif.
CREATE POLICY "clarifications_person_read" ON "clarifications" FOR SELECT
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "clarification_responses_person_read" ON "clarification_responses" FOR SELECT
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
