ALTER TABLE "declaration_versions" ADD COLUMN "ack_verify_url" text;--> statement-breakpoint
ALTER TABLE "declaration_versions" ADD COLUMN "ack_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "declaration_versions_ack_verification_id_idx" ON "declaration_versions" USING btree ("ack_verification_id");