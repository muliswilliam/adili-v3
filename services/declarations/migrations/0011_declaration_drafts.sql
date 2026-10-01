CREATE TABLE "declaration_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"declaration_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"item_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size" bigint NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declaration_attachments_upload_id_key" UNIQUE("upload_id")
);
--> statement-breakpoint
CREATE TABLE "declaration_sections" (
	"declaration_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"envelope" jsonb NOT NULL,
	"completeness" text DEFAULT 'not-started' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"saved_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "declaration_sections_declaration_id_section_key_pk" PRIMARY KEY("declaration_id","section_key"),
	CONSTRAINT "declaration_sections_completeness_check" CHECK ("declaration_sections"."completeness" in ('not-started', 'incomplete', 'complete', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "declarations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"person_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"roster_record_id" uuid NOT NULL,
	"type" text NOT NULL,
	"statement_date" date NOT NULL,
	"income_period_from" date NOT NULL,
	"income_period_to" date NOT NULL,
	"previous_statement_date_source" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"schema_version" text DEFAULT 'declaration.v1' NOT NULL,
	"draft_version" integer DEFAULT 1 NOT NULL,
	"last_section" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declarations_type_check" CHECK ("declarations"."type" in ('initial', 'biennial', 'final')),
	CONSTRAINT "declarations_status_check" CHECK ("declarations"."status" in ('draft', 'amending', 'submitted', 'discarded')),
	CONSTRAINT "declarations_previous_statement_date_source_check" CHECK ("declarations"."previous_statement_date_source" in ('declared', 'assumed'))
);
--> statement-breakpoint
ALTER TABLE "declaration_attachments" ADD CONSTRAINT "declaration_attachments_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_sections" ADD CONSTRAINT "declaration_sections_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "declaration_attachments_declaration_id_idx" ON "declaration_attachments" USING btree ("declaration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "declarations_live_obligation_key" ON "declarations" USING btree ("obligation_id") WHERE "declarations"."status" <> 'discarded';--> statement-breakpoint
CREATE INDEX "declarations_person_id_idx" ON "declarations" USING btree ("person_id");