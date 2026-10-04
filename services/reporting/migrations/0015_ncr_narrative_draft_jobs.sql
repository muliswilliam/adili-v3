-- A narrative draft may take more than one ai-gateway job: `all` in a year with no pattern
-- candidates is the overview's and the recommendations' (spec 09b). Each draft keeps its job,
-- with the section it was asked for.
ALTER TABLE "national_report_narrative_drafts" ADD COLUMN "jobs" jsonb;--> statement-breakpoint
UPDATE "national_report_narrative_drafts" SET "jobs" = jsonb_build_array(jsonb_build_object('section', "section", 'jobId', "job_id"));--> statement-breakpoint
ALTER TABLE "national_report_narrative_drafts" ALTER COLUMN "jobs" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "national_report_narrative_drafts" DROP COLUMN "job_id";