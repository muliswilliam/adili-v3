CREATE TABLE "bulk_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"approver" text NOT NULL,
	"cycle_year" integer NOT NULL,
	"type" text,
	"chunks" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "closure_sweeps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"cycle_year" integer NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	"sample_rate" real NOT NULL,
	"proposed" integer NOT NULL,
	"sampled" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_cases" ADD COLUMN "sampled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "determinations" ADD COLUMN "bulk_approval_id" uuid;--> statement-breakpoint
CREATE INDEX "closure_sweeps_tenant_cycle_idx" ON "closure_sweeps" USING btree ("tenant","cycle_year","ran_at");--> statement-breakpoint
CREATE INDEX "review_cases_closure_idx" ON "review_cases" USING btree ("tenant","cycle_year","band","status");--> statement-breakpoint
CREATE INDEX "determinations_bulk_approval_idx" ON "determinations" USING btree ("bulk_approval_id");--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls).
ALTER TABLE "closure_sweeps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "closure_sweeps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "closure_sweeps_tenant_isolation" ON "closure_sweeps"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "bulk_approvals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bulk_approvals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "bulk_approvals_tenant_isolation" ON "bulk_approvals"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
