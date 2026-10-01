-- The person each fact is about, by id only. Projections: rows projected before stay null until
-- an event carrying the id arrives; nothing to backfill.
ALTER TABLE "action_facts" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "clarification_facts" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "obligation_facts" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "referral_facts" ADD COLUMN "person_id" uuid;