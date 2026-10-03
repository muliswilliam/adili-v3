ALTER TABLE "suggestion_sets" ADD COLUMN "attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "suggestion_sets" ADD COLUMN "document_kind" text;--> statement-breakpoint
ALTER TABLE "suggestion_sets" ADD COLUMN "target_section" text;--> statement-breakpoint
ALTER TABLE "suggestion_sets" ADD COLUMN "target_item_type" text;--> statement-breakpoint
ALTER TABLE "suggestion_sets" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE INDEX "suggestion_sets_ai_job_id_idx" ON "suggestion_sets" USING btree ("ai_job_id");--> statement-breakpoint
ALTER TABLE "suggestion_sets" ADD CONSTRAINT "suggestion_sets_document_check" CHECK (("suggestion_sets"."source" = 'document') = ("suggestion_sets"."attachment_id" is not null and "suggestion_sets"."document_kind" is not null and "suggestion_sets"."target_section" is not null and "suggestion_sets"."target_item_type" is not null));