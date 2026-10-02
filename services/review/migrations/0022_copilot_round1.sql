ALTER TABLE "review_copilot_drafts" DROP CONSTRAINT "review_copilot_drafts_content_check";--> statement-breakpoint
ALTER TABLE "clarifications" ADD COLUMN "ai_assisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_summary_prompt_version" integer;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_summary_ciphertext" text;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_summary_envelope" jsonb;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_explanations_prompt_version" integer;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_explanations_ciphertext" text;--> statement-breakpoint
ALTER TABLE "review_copilots" ADD COLUMN "staged_explanations_envelope" jsonb;--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" ADD CONSTRAINT "review_copilot_drafts_content_check" CHECK (("review_copilot_drafts"."status" = 'ready' and "review_copilot_drafts"."purged_at" is null) = ("review_copilot_drafts"."ciphertext" is not null and "review_copilot_drafts"."envelope" is not null));