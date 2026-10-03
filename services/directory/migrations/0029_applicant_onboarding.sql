ALTER TABLE "onboarding_sessions" DROP CONSTRAINT "onboarding_sessions_email_source_check";--> statement-breakpoint
ALTER TABLE "onboarding_sessions" DROP CONSTRAINT "onboarding_sessions_phone_source_check";--> statement-breakpoint
ALTER TABLE "persons" DROP CONSTRAINT "persons_kind_check";--> statement-breakpoint
DROP INDEX "persons_national_id_key";--> statement-breakpoint
ALTER TABLE "onboarding_otps" ALTER COLUMN "tenant" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ALTER COLUMN "tenant" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ALTER COLUMN "roster_record_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD COLUMN "kind" text DEFAULT 'declarant' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD COLUMN "document_kind" text;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD COLUMN "document_number" text;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD COLUMN "document_country" text;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD COLUMN "surname" text;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD COLUMN "other_names" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "passport_number" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "passport_country" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "identity_status" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "identity_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "identity_verified_by" text;--> statement-breakpoint
ALTER TABLE "onboarding_otps" ADD CONSTRAINT "onboarding_otps_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."onboarding_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "persons_kind_national_id_key" ON "persons" USING btree ("kind","national_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_passport_key" ON "persons" USING btree ("passport_country","passport_number");--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_kind_check" CHECK ("onboarding_sessions"."kind" in ('declarant', 'applicant'));--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_kind_columns_check" CHECK (("onboarding_sessions"."kind" = 'declarant' and "onboarding_sessions"."tenant" is not null and "onboarding_sessions"."roster_record_id" is not null and "onboarding_sessions"."document_kind" is null) or ("onboarding_sessions"."kind" = 'applicant' and "onboarding_sessions"."tenant" is null and "onboarding_sessions"."roster_record_id" is null and "onboarding_sessions"."document_kind" in ('national-id', 'passport') and "onboarding_sessions"."document_number" is not null and ("onboarding_sessions"."document_kind" = 'passport') = ("onboarding_sessions"."document_country" is not null) and "onboarding_sessions"."surname" is not null and "onboarding_sessions"."first_name" is not null));--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_email_source_check" CHECK (("onboarding_sessions"."email" is null) = ("onboarding_sessions"."email_source" is null) and ("onboarding_sessions"."email_source" is null or "onboarding_sessions"."email_source" in ('roster', 'declarant', 'applicant')));--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_phone_source_check" CHECK (("onboarding_sessions"."phone" is null) = ("onboarding_sessions"."phone_source" is null) and ("onboarding_sessions"."phone_source" is null or "onboarding_sessions"."phone_source" in ('roster', 'declarant', 'applicant')));--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_applicant_identity_check" CHECK ("persons"."kind" <> 'applicant' or ("persons"."ofr" is null and "persons"."identity_status" is not null and ("persons"."national_id" is null) <> ("persons"."passport_number" is null) and ("persons"."passport_number" is null) = ("persons"."passport_country" is null)));--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_applicant_only_check" CHECK ("persons"."kind" = 'applicant' or ("persons"."passport_number" is null and "persons"."passport_country" is null and "persons"."identity_status" is null));--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_identity_status_check" CHECK ("persons"."identity_status" is null or "persons"."identity_status" in ('verified', 'pending-verification'));--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_identity_verified_check" CHECK ("persons"."identity_status" is null or ("persons"."identity_status" = 'verified') = ("persons"."identity_verified_at" is not null));--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_kind_check" CHECK ("persons"."kind" in ('declarant', 'law-enforcement', 'applicant'));