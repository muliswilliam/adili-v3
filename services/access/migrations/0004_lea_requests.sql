DROP TABLE "agencies" CASCADE;--> statement-breakpoint
ALTER TABLE "lea_requests" ADD COLUMN "officer_person_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "lea_requests" ADD COLUMN "provenance" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lea_requests" ADD COLUMN "declarant_notified_at" timestamp with time zone;