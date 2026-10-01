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
-- List-partitioned by cycle year (ADR-001). drizzle-kit cannot express partitioning, so the
-- PARTITION BY clause is added by hand; the partitions are in migration 0016.
CREATE TABLE "declaration_items" (
	"id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"cycle_year" integer NOT NULL,
	"tenant" text NOT NULL,
	"person_key" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"in_kenya" boolean NOT NULL,
	"county" text,
	"country" text,
	"is_joint" boolean NOT NULL,
	"share_percent" numeric(5, 2),
	"change_kind" text,
	"item_id" uuid NOT NULL,
	"description_ciphertext" "bytea" NOT NULL,
	"value_ciphertext" "bytea" NOT NULL,
	"envelope" jsonb NOT NULL,
	CONSTRAINT "declaration_items_id_cycle_year_pk" PRIMARY KEY("id","cycle_year"),
	CONSTRAINT "declaration_items_category_check" CHECK ("declaration_items"."category" in ('income', 'asset', 'liability'))
) PARTITION BY LIST ("cycle_year");
--> statement-breakpoint
-- List-partitioned by cycle year (ADR-001). drizzle-kit cannot express partitioning, so the
-- PARTITION BY clause is added by hand; the partitions are in migration 0016.
CREATE TABLE "declaration_versions" (
	"id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"cycle_year" integer NOT NULL,
	"tenant" text NOT NULL,
	"person_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"snapshot_ciphertext" "bytea" NOT NULL,
	"envelope" jsonb NOT NULL,
	"canonical_sha256" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"late" boolean NOT NULL,
	"step_up_acr" text NOT NULL,
	"step_up_auth_time" timestamp with time zone NOT NULL,
	"step_up_token_id_hash" text,
	"idempotency_key_hash" text NOT NULL,
	"superseded_at" timestamp with time zone,
	"ack_status" text DEFAULT 'pending' NOT NULL,
	"ack_document_id" uuid,
	"ack_verification_id" text,
	"ack_verify_url" text,
	"ack_issued_at" timestamp with time zone,
	"ack_requested_at" timestamp with time zone,
	"verified_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declaration_versions_id_cycle_year_pk" PRIMARY KEY("id","cycle_year"),
	CONSTRAINT "declaration_versions_declaration_version_key" UNIQUE("declaration_id","cycle_year","version"),
	CONSTRAINT "declaration_versions_version_check" CHECK ("declaration_versions"."version" >= 1),
	CONSTRAINT "declaration_versions_ack_status_check" CHECK ("declaration_versions"."ack_status" in ('pending', 'issued', 'failed'))
) PARTITION BY LIST ("cycle_year");
--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "current_version" integer;--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "amending_from_version" integer;--> statement-breakpoint
ALTER TABLE "filing_obligations" ADD COLUMN "filed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "filing_obligations" ADD COLUMN "filed_version_id" uuid;--> statement-breakpoint
ALTER TABLE "filing_obligations" ADD COLUMN "late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "declaration_items" ADD CONSTRAINT "declaration_items_version_fk" FOREIGN KEY ("version_id","cycle_year") REFERENCES "public"."declaration_versions"("id","cycle_year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_versions" ADD CONSTRAINT "declaration_versions_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "declaration_items_version_id_idx" ON "declaration_items" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "declaration_items_tenant_category_type_idx" ON "declaration_items" USING btree ("tenant","category","type");--> statement-breakpoint
CREATE INDEX "declaration_versions_ack_verification_id_idx" ON "declaration_versions" USING btree ("ack_verification_id");