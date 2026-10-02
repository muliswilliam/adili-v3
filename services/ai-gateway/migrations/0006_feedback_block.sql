ALTER TABLE "feedback" DROP CONSTRAINT "feedback_id_unique";--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_job_id_reviewer_subject_pk";--> statement-breakpoint
ALTER TABLE "feedback" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "block" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_job_id_reviewer_subject_block_unique" UNIQUE NULLS NOT DISTINCT("job_id","reviewer_subject","block");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_block_check" CHECK (char_length("feedback"."block") <= 64);