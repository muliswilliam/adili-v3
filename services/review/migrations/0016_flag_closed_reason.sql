ALTER TABLE "review_flags" ADD COLUMN "closed_reason" text;--> statement-breakpoint
CREATE INDEX "review_cases_registry_unavailable_idx" ON "review_cases" USING btree ("id") WHERE "review_cases"."registry_unavailable";--> statement-breakpoint
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_closed_reason_check" CHECK ("review_flags"."closed_reason" in ('superseded-by-recheck'));