ALTER TABLE "review_copilot_ratings" DROP CONSTRAINT "review_copilot_ratings_job_id_reviewer_subject_pk";--> statement-breakpoint
ALTER TABLE "review_copilot_ratings" ADD COLUMN "block" text;--> statement-breakpoint
ALTER TABLE "review_copilot_ratings" ADD CONSTRAINT "review_copilot_ratings_job_reviewer_block_key" UNIQUE NULLS NOT DISTINCT("job_id","reviewer_subject","block");