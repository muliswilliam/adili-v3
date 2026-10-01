ALTER TABLE "messages" ALTER COLUMN "recipient_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "recipient_person_id" uuid;--> statement-breakpoint
CREATE INDEX "messages_recipient_person_idx" ON "messages" USING btree ("recipient_person_id","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_check" CHECK ("messages"."recipient_hash" is not null or "messages"."recipient_person_id" is not null);