CREATE TABLE "payroll_instructions" (
	"instruction_reference" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"employer_code" text NOT NULL,
	"personal_number_hash" text NOT NULL,
	"national_id_hash" text NOT NULL,
	"effective_date" date NOT NULL,
	"status" text NOT NULL,
	"payroll_reference" text,
	"received_at" timestamp with time zone,
	"sent_at" timestamp with time zone NOT NULL,
	"requested_by" text NOT NULL,
	"legal_basis" text NOT NULL,
	"case_ref" text
);
--> statement-breakpoint
CREATE TABLE "system_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"system" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"latency_ms" integer NOT NULL,
	"caller" text NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "system_calls_system_called_idx" ON "system_calls" USING btree ("system","called_at");