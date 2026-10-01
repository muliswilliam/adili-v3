CREATE TABLE "verification_projection" (
	"verification_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"disclosure_level" text NOT NULL,
	"public_payload" jsonb,
	"sha256" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"superseded_by" text,
	"revoked_reason" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_projection_status_check" CHECK ("verification_projection"."status" in ('valid', 'superseded', 'revoked', 'expired')),
	CONSTRAINT "verification_projection_disclosure_level_check" CHECK ("verification_projection"."disclosure_level" in ('public', 'restricted', 'confidential')),
	CONSTRAINT "verification_projection_sha256_check" CHECK ("verification_projection"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "verification_projection_confidential_check" CHECK ("verification_projection"."disclosure_level" <> 'confidential' or ("verification_projection"."public_payload" is null and "verification_projection"."superseded_by" is null))
);
