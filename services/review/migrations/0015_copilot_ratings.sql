CREATE TABLE "review_copilot_ratings" (
	"job_id" uuid NOT NULL,
	"reviewer_subject" text NOT NULL,
	"tenant" text NOT NULL,
	"case_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"rated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_copilot_ratings_job_id_reviewer_subject_pk" PRIMARY KEY("job_id","reviewer_subject"),
	CONSTRAINT "review_copilot_ratings_rating_check" CHECK ("review_copilot_ratings"."rating" in ('helpful', 'not-helpful'))
);
--> statement-breakpoint
ALTER TABLE "review_copilot_ratings" ADD CONSTRAINT "review_copilot_ratings_case_id_review_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_copilots_summary_job_id_idx" ON "review_copilots" USING btree ("summary_job_id");--> statement-breakpoint
CREATE INDEX "review_copilots_explanations_job_id_idx" ON "review_copilots" USING btree ("explanations_job_id");--> statement-breakpoint
-- Tenant data like every review table (see 0002_review_rls).
ALTER TABLE "review_copilot_ratings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_copilot_ratings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "review_copilot_ratings_tenant_isolation" ON "review_copilot_ratings"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
