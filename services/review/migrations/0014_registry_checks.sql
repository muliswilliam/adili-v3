CREATE TABLE "registry_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"person_key" text NOT NULL,
	"system" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result_id" uuid,
	CONSTRAINT "registry_checks_system_check" CHECK ("registry_checks"."system" in ('kra', 'ntsa', 'brs', 'ardhisasa')),
	CONSTRAINT "registry_checks_status_check" CHECK ("registry_checks"."status" in ('matched', 'mismatched', 'unavailable', 'not-checked', 'no-id'))
);
--> statement-breakpoint
ALTER TABLE "review_cases" ADD COLUMN "registry_unavailable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_checks" ADD CONSTRAINT "registry_checks_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registry_checks_case_person_system_key" ON "registry_checks" USING btree ("case_id","person_key","system");--> statement-breakpoint
CREATE INDEX "registry_checks_tenant_status_idx" ON "registry_checks" USING btree ("tenant","status");--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls). No person policy: the declarant
-- never reads the registry checks of their case.
ALTER TABLE "registry_checks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "registry_checks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "registry_checks_tenant_isolation" ON "registry_checks"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');