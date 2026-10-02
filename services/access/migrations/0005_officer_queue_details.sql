ALTER TABLE "access_requests" ADD COLUMN "resolved_file_number" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "closed_at" timestamp with time zone;