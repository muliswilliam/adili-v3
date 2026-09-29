CREATE TABLE "review_case_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"late" boolean NOT NULL,
	"amendment" boolean NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_case_versions" ADD CONSTRAINT "review_case_versions_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_case_versions_case_version_key" ON "review_case_versions" USING btree ("case_id","version");--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls).
ALTER TABLE "review_case_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_case_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_case_versions_tenant_isolation" ON "review_case_versions"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
