CREATE TABLE "audit_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"tenant" text NOT NULL,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid,
	"subject_ref" text,
	"task" text,
	"prompt_version" integer,
	"data_class" text,
	"provider" text,
	"model" text,
	"input_hash" text,
	"output_hash" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_micros" integer,
	"latency_ms" integer,
	"outcome" text,
	"reason" text,
	"approval_ref" text,
	"change" jsonb
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"tenant" text PRIMARY KEY NOT NULL,
	"monthly_tokens" bigint NOT NULL,
	"per_minute" integer NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"reviewer_subject" text NOT NULL,
	"block" text,
	"rating" text NOT NULL,
	"reason" text,
	"note_ciphertext" text,
	"note_envelope" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_job_id_reviewer_subject_block_unique" UNIQUE NULLS NOT DISTINCT("job_id","reviewer_subject","block"),
	CONSTRAINT "feedback_block_check" CHECK (char_length("feedback"."block") <= 64),
	CONSTRAINT "feedback_rating_check" CHECK ("feedback"."rating" in ('helpful', 'not-helpful')),
	CONSTRAINT "feedback_reason_check" CHECK ("feedback"."reason" is null or "feedback"."reason" in ('inaccurate', 'missed-something', 'unclear', 'too-long', 'other')),
	CONSTRAINT "feedback_note_sealed" CHECK (("feedback"."note_ciphertext" is null) = ("feedback"."note_envelope" is null))
);
--> statement-breakpoint
CREATE TABLE "gate_policies" (
	"tenant" text NOT NULL,
	"data_class" text NOT NULL,
	"provider_class" text NOT NULL,
	"allowed" boolean NOT NULL,
	"approval_ref" text NOT NULL,
	"changed_by" text NOT NULL,
	"changed_by_name" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gate_policies_tenant_data_class_provider_class_pk" PRIMARY KEY("tenant","data_class","provider_class")
);
--> statement-breakpoint
CREATE TABLE "routing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "jobs_caller_idempotency_key_idx";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_records_job_id_idx" ON "audit_records" USING btree ("job_id") WHERE "audit_records"."job_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_records_tenant_occurred_at_idx" ON "audit_records" USING btree ("tenant","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_tenant_task_idx" ON "routing" USING btree ("tenant","task") WHERE "routing"."tenant" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_default_task_idx" ON "routing" USING btree ("task") WHERE "routing"."tenant" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_tenant_caller_idempotency_key_idx" ON "jobs" USING btree ("tenant","caller","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_tenant_created_at_idx" ON "jobs" USING btree ("tenant","created_at");--> statement-breakpoint
-- Audit records are append-only (ADR-008): what was recorded is never changed or removed.
CREATE FUNCTION "audit_records_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit records are append-only' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_records_append_only" BEFORE UPDATE OR DELETE ON "audit_records"
	FOR EACH ROW EXECUTE FUNCTION "audit_records_append_only"();
--> statement-breakpoint
-- Jobs, gate rules, budgets, feedback and audit records are tenant data (ADR-006): a transaction
-- sees and writes its tenant's rows (`app.tenant`), platform work every tenant's. FORCE applies
-- the policies to the service's own role, which owns the tables.
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "jobs_tenant_isolation" ON "jobs"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "gate_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "gate_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "gate_policies_tenant_isolation" ON "gate_policies"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "budgets_tenant_isolation" ON "budgets"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "feedback" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "feedback_tenant_isolation" ON "feedback"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "audit_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_records_tenant_isolation" ON "audit_records"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- A tenant's transactions read its own routes and the default ones (null tenant), which every
-- tenant follows; only platform work writes a default route.
ALTER TABLE "routing" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "routing" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "routing_tenant_isolation" ON "routing"
	USING ("tenant" IS NULL OR "tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
