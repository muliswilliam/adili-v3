DROP INDEX "verification_records_reference_idx";--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "reference" text;--> statement-breakpoint
CREATE INDEX "issued_documents_reference_idx" ON "issued_documents" USING btree ("tenant","type","reference");