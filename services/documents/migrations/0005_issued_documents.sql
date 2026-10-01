CREATE TABLE "issued_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"type" text NOT NULL,
	"template_version" integer NOT NULL,
	"disclosure_level" text NOT NULL,
	"subject_ref" text NOT NULL,
	"reference" text,
	"subject_version" integer,
	"subject_person_id" uuid,
	"verification_id" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"signer_name" text NOT NULL,
	"signer_certificate_sha256" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_by" text NOT NULL,
	CONSTRAINT "issued_documents_verificationId_unique" UNIQUE("verification_id"),
	CONSTRAINT "issued_documents_objectKey_unique" UNIQUE("object_key"),
	CONSTRAINT "issued_documents_type_subject_key" UNIQUE("type","subject_ref"),
	CONSTRAINT "issued_documents_disclosure_level_check" CHECK ("issued_documents"."disclosure_level" in ('public', 'restricted', 'confidential')),
	CONSTRAINT "issued_documents_sha256_check" CHECK ("issued_documents"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "verification_records" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"document_type" text NOT NULL,
	"template_version" integer NOT NULL,
	"disclosure_level" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"content_sha256" text NOT NULL,
	"public_payload" jsonb,
	"status" text DEFAULT 'valid' NOT NULL,
	"status_reason_category" text,
	"superseded_by" uuid,
	"status_changed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"record_signature" text NOT NULL,
	"record_signing_key_version" integer NOT NULL,
	CONSTRAINT "verification_records_documentId_unique" UNIQUE("document_id"),
	CONSTRAINT "verification_records_status_check" CHECK ("verification_records"."status" in ('valid', 'superseded', 'revoked', 'expired')),
	CONSTRAINT "verification_records_superseded_check" CHECK (("verification_records"."status" = 'superseded') = ("verification_records"."superseded_by" is not null)),
	CONSTRAINT "verification_records_public_payload_check" CHECK (("verification_records"."disclosure_level" = 'confidential') = ("verification_records"."public_payload" is null))
);
--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_document_id_issued_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."issued_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_superseded_by_issued_documents_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."issued_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issued_documents_subject_person_idx" ON "issued_documents" USING btree ("subject_person_id");--> statement-breakpoint
CREATE INDEX "issued_documents_reference_idx" ON "issued_documents" USING btree ("tenant","type","reference");--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_linked_at_check" CHECK ("uploads"."linked_at" is null or "uploads"."state" = 'clean');