CREATE TABLE "suggestion_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"declaration_id" uuid NOT NULL,
	"person_key" text NOT NULL,
	"consented_by" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"text_version" text NOT NULL,
	"systems" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestion_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"declaration_id" uuid NOT NULL,
	"person_key" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"consent_id" uuid,
	"verification_result_id" uuid,
	"ai_job_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "suggestion_sets_source_check" CHECK ("suggestion_sets"."source" in ('kra', 'ntsa', 'brs', 'ardhisasa', 'document')),
	CONSTRAINT "suggestion_sets_status_check" CHECK ("suggestion_sets"."status" in ('pending', 'ready', 'unavailable', 'no-id', 'not-enabled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"set_id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"person_key" text NOT NULL,
	"section_key" text NOT NULL,
	"item_type" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"envelope" jsonb NOT NULL,
	"confidence" real,
	"match_item_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"reason" text,
	"accepted_item_id" uuid,
	"verification_result_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "suggestions_status_check" CHECK ("suggestions"."status" in ('new', 'accepted', 'dismissed', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "suggestion_consents" ADD CONSTRAINT "suggestion_consents_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_sets" ADD CONSTRAINT "suggestion_sets_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_sets" ADD CONSTRAINT "suggestion_sets_consent_id_suggestion_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."suggestion_consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_set_id_suggestion_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."suggestion_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestion_consents_declaration_id_idx" ON "suggestion_consents" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "suggestion_sets_declaration_id_idx" ON "suggestion_sets" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "suggestions_set_id_idx" ON "suggestions" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "suggestions_declaration_id_idx" ON "suggestions" USING btree ("declaration_id");