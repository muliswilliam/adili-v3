-- Onboarding sessions, their codes and the failure counter are tenant data (ADR-006), under the
-- roster's policy (0009). The public onboarding routes act as a system actor: they find a session
-- by id in the `platform` context, then set `app.tenant` to its Commission for the rest of the
-- transaction. `persons` and `numbering_counters` are platform-level and have no policy.
ALTER TABLE "onboarding_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "onboarding_sessions_tenant_isolation" ON "onboarding_sessions"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "onboarding_otps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_otps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "onboarding_otps_tenant_isolation" ON "onboarding_otps"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "onboarding_failures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_failures" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "onboarding_failures_tenant_isolation" ON "onboarding_failures"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
