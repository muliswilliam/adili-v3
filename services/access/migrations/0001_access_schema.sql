CREATE TABLE "agencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_basis" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lea_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"commission_name" text NOT NULL,
	"reference" text NOT NULL,
	"officer_subject" text NOT NULL,
	"officer_name" text NOT NULL,
	"agency_code" text NOT NULL,
	"agency_name" text NOT NULL,
	"officer_sought" jsonb NOT NULL,
	"reason" text NOT NULL,
	"case_reference" text NOT NULL,
	"scope" jsonb NOT NULL,
	"status" text NOT NULL,
	"resolved_roster_record_id" uuid,
	"resolved_person_id" uuid,
	"resolved_name" text,
	"verification" jsonb,
	"received_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"reminded_at" timestamp with time zone,
	"breached_at" timestamp with time zone,
	"decision" jsonb,
	"package_document_id" uuid,
	"package_verification_id" text,
	"package_issued_at" timestamp with time zone,
	"download_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lea_requests_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "access_register" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"reference" text,
	"person_id" uuid,
	"kind" text NOT NULL,
	"actor" text,
	"actor_name" text,
	"legal_basis" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"commission_name" text NOT NULL,
	"reference" text NOT NULL,
	"applicant_person_id" uuid NOT NULL,
	"applicant_subject" text NOT NULL,
	"applicant_name" text NOT NULL,
	"applicant_identity_status" text NOT NULL,
	"applicant_verification" jsonb,
	"form_k_ciphertext" text NOT NULL,
	"form_k_envelope" jsonb NOT NULL,
	"officer_sought" jsonb NOT NULL,
	"scope" jsonb NOT NULL,
	"status" text NOT NULL,
	"resolved_roster_record_id" uuid,
	"resolved_person_id" uuid,
	"resolved_name" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"window_ends_at" timestamp with time zone,
	"submitted_at" timestamp with time zone NOT NULL,
	"decision_deadline_at" timestamp with time zone NOT NULL,
	"decision" jsonb,
	"package_document_id" uuid,
	"package_verification_id" text,
	"package_issued_at" timestamp with time zone,
	"download_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "representations" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"person_id" uuid NOT NULL,
	"stance" text NOT NULL,
	"text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certified_copies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"person_id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"document_id" uuid,
	"verification_id" text,
	"application_id" uuid,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certified_copies_version_key" UNIQUE NULLS NOT DISTINCT("person_id","declaration_id","version","application_id")
);
--> statement-breakpoint
CREATE TABLE "self_access_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"person_id" uuid NOT NULL,
	"roster_record_id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"identity_note" text NOT NULL,
	"representative" jsonb,
	"representative_id_ciphertext" text,
	"representative_id_envelope" jsonb,
	"status" text NOT NULL,
	"delivery_method" text,
	"delivered_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_by_name" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text NOT NULL,
	"principal_subject" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" json,
	"claim_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_principal_subject_pk" PRIMARY KEY("key","principal_subject")
);
--> statement-breakpoint
CREATE TABLE "numbering_counters" (
	"scheme" text NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"period" integer DEFAULT 0 NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "numbering_counters_scheme_issuer_period_pk" PRIMARY KEY("scheme","issuer","period")
);
--> statement-breakpoint
ALTER TABLE "representations" ADD CONSTRAINT "representations_request_id_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."access_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lea_requests_queue_idx" ON "lea_requests" USING btree ("tenant","status","deadline_at","id");--> statement-breakpoint
CREATE INDEX "lea_requests_officer_idx" ON "lea_requests" USING btree ("officer_subject","received_at");--> statement-breakpoint
CREATE INDEX "lea_requests_declarant_idx" ON "lea_requests" USING btree ("resolved_person_id");--> statement-breakpoint
CREATE INDEX "access_register_subject_idx" ON "access_register" USING btree ("subject_id","at");--> statement-breakpoint
CREATE INDEX "access_register_person_idx" ON "access_register" USING btree ("person_id","at");--> statement-breakpoint
CREATE INDEX "access_register_tenant_idx" ON "access_register" USING btree ("tenant","at");--> statement-breakpoint
CREATE INDEX "access_requests_queue_idx" ON "access_requests" USING btree ("tenant","status","decision_deadline_at","id");--> statement-breakpoint
CREATE INDEX "access_requests_applicant_idx" ON "access_requests" USING btree ("applicant_person_id","submitted_at");--> statement-breakpoint
CREATE INDEX "access_requests_declarant_idx" ON "access_requests" USING btree ("resolved_person_id","notified_at");--> statement-breakpoint
CREATE INDEX "certified_copies_person_idx" ON "certified_copies" USING btree ("person_id","requested_at");--> statement-breakpoint
CREATE INDEX "self_access_applications_tenant_idx" ON "self_access_applications" USING btree ("tenant","deadline_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");