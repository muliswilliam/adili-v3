ALTER TABLE "clarifications" ADD COLUMN "opening_ai_language" text;--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_opening_ai_language_check" CHECK ("clarifications"."opening_ai_language" in ('en', 'sw'));--> statement-breakpoint
ALTER TABLE "review_copilot_drafts" ADD CONSTRAINT "review_copilot_drafts_language_check" CHECK ("review_copilot_drafts"."language" in ('en', 'sw'));