ALTER TABLE "representations" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lea_requests" ADD COLUMN "written_notice" jsonb;--> statement-breakpoint
ALTER TABLE "lea_requests" ADD COLUMN "declarant_invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "declarant_invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "written_notice" jsonb;--> statement-breakpoint
ALTER TABLE "representations" ADD COLUMN "received_in_writing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "representations" ADD COLUMN "recorded_by" text;--> statement-breakpoint
ALTER TABLE "representations" ADD COLUMN "recorded_by_name" text;--> statement-breakpoint
CREATE INDEX "lea_requests_roster_record_idx" ON "lea_requests" USING btree ("resolved_roster_record_id");--> statement-breakpoint
CREATE INDEX "access_requests_roster_record_idx" ON "access_requests" USING btree ("resolved_roster_record_id");