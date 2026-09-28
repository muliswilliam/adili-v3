CREATE TABLE "onboarding_attempts" (
	"tenant" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"failures" integer NOT NULL,
	CONSTRAINT "onboarding_attempts_tenant_window_start_pk" PRIMARY KEY("tenant","window_start")
);
--> statement-breakpoint
CREATE TABLE "onboarding_otps" (
	"session_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"tenant" text NOT NULL,
	"code_hmac" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"resends" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "onboarding_otps_session_id_channel_pk" PRIMARY KEY("session_id","channel"),
	CONSTRAINT "onboarding_otps_channel_check" CHECK ("onboarding_otps"."channel" in ('email', 'phone'))
);
--> statement-breakpoint
CREATE TABLE "onboarding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant" text NOT NULL,
	"roster_record_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"state" text NOT NULL,
	"email" text,
	"email_source" text,
	"email_verified_at" timestamp with time zone,
	"phone" text,
	"phone_source" text,
	"phone_verified_at" timestamp with time zone,
	"iprs_outcome" text,
	"outcome" text,
	"end_reason" text,
	"person_id" uuid,
	"password_email_sent_at" timestamp with time zone,
	"client_ip_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_sessions_state_check" CHECK ("onboarding_sessions"."state" in ('identified', 'email-contact-required', 'email-pending', 'email-verified', 'phone-contact-required', 'phone-pending', 'phone-verified', 'confirmed', 'identity-mismatch', 'expired')),
	CONSTRAINT "onboarding_sessions_email_source_check" CHECK (("onboarding_sessions"."email" is null) = ("onboarding_sessions"."email_source" is null) and ("onboarding_sessions"."email_source" is null or "onboarding_sessions"."email_source" in ('roster', 'declarant'))),
	CONSTRAINT "onboarding_sessions_phone_source_check" CHECK (("onboarding_sessions"."phone" is null) = ("onboarding_sessions"."phone_source" is null) and ("onboarding_sessions"."phone_source" is null or "onboarding_sessions"."phone_source" in ('roster', 'declarant'))),
	CONSTRAINT "onboarding_sessions_completed_at_check" CHECK (("onboarding_sessions"."state" in ('confirmed', 'identity-mismatch', 'expired')) = ("onboarding_sessions"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"national_id" text NOT NULL,
	"full_name" text NOT NULL,
	"ofr" text NOT NULL,
	"keycloak_user_id" text NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "roster_records" ADD COLUMN "email_source" text DEFAULT 'roster' NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_records" ADD COLUMN "phone_source" text DEFAULT 'roster' NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_records" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "roster_records" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roster_records" ADD COLUMN "identity_mismatch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_attempts" ADD CONSTRAINT "onboarding_attempts_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_otps" ADD CONSTRAINT "onboarding_otps_session_id_onboarding_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."onboarding_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_roster_record_id_roster_records_id_fk" FOREIGN KEY ("roster_record_id") REFERENCES "public"."roster_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_sessions_tenant_created_at_idx" ON "onboarding_sessions" USING btree ("tenant","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_sessions_roster_record_id_idx" ON "onboarding_sessions" USING btree ("roster_record_id");--> statement-breakpoint
CREATE INDEX "onboarding_sessions_live_expires_at_idx" ON "onboarding_sessions" USING btree ("expires_at") WHERE "onboarding_sessions"."state" not in ('confirmed', 'identity-mismatch', 'expired');--> statement-breakpoint
CREATE UNIQUE INDEX "persons_national_id_key" ON "persons" USING btree ("national_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_ofr_key" ON "persons" USING btree ("ofr");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_keycloak_user_id_key" ON "persons" USING btree ("keycloak_user_id");--> statement-breakpoint
ALTER TABLE "roster_records" ADD CONSTRAINT "roster_records_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_records_tenant_identity_mismatch_at_idx" ON "roster_records" USING btree ("tenant","identity_mismatch_at") WHERE "roster_records"."identity_mismatch_at" is not null;--> statement-breakpoint
CREATE INDEX "roster_records_person_id_idx" ON "roster_records" USING btree ("person_id") WHERE "roster_records"."person_id" is not null;--> statement-breakpoint
ALTER TABLE "roster_records" ADD CONSTRAINT "roster_records_email_source_check" CHECK ("roster_records"."email_source" in ('roster', 'declarant'));--> statement-breakpoint
ALTER TABLE "roster_records" ADD CONSTRAINT "roster_records_phone_source_check" CHECK ("roster_records"."phone_source" in ('roster', 'declarant'));