CREATE TABLE "access_request_facts" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"fy" integer,
	"received_at" timestamp with time zone,
	"outcome" text,
	"grounds" text[] DEFAULT '{}' NOT NULL,
	"closed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "access_request_facts_tenant_fy_idx" ON "access_request_facts" USING btree ("tenant","fy");--> statement-breakpoint
-- Tenant data like every fact table (see 0002_reporting_rls).
ALTER TABLE "access_request_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "access_request_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "access_request_facts_tenant_isolation" ON "access_request_facts"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
