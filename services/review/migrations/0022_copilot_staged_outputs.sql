ALTER TABLE "review_copilots" ADD COLUMN "staged_summary_prompt_version" integer;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_summary_ciphertext" text;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_summary_envelope" jsonb;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_explanations_prompt_version" integer;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_explanations_ciphertext" text;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_explanations_envelope" jsonb;