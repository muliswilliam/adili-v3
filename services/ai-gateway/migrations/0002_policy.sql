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
CREATE TABLE "gate_policies" (
	"tenant" text NOT NULL,
	"data_class" text NOT NULL,
	"provider_class" text NOT NULL,
	"allowed" boolean NOT NULL,
	"approval_ref" text NOT NULL,
	"changed_by" text NOT NULL,
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
ALTER TABLE "jobs" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_records_job_id_idx" ON "audit_records" USING btree ("job_id") WHERE "audit_records"."job_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_records_tenant_occurred_at_idx" ON "audit_records" USING btree ("tenant","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_tenant_task_idx" ON "routing" USING btree ("tenant","task") WHERE "routing"."tenant" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_default_task_idx" ON "routing" USING btree ("task") WHERE "routing"."tenant" is null;--> statement-breakpoint
CREATE INDEX "jobs_tenant_created_at_idx" ON "jobs" USING btree ("tenant","created_at");