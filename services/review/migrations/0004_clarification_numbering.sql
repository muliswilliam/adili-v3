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
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");