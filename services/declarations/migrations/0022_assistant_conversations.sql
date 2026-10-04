CREATE TABLE "assistant_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"declaration_id" uuid,
	"tenant" text NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "assistant_conversations_language_check" CHECK ("assistant_conversations"."language" in ('en', 'sw')),
	CONSTRAINT "assistant_conversations_expiry_check" CHECK (("assistant_conversations"."declaration_id" is null) = ("assistant_conversations"."expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"envelope" jsonb NOT NULL,
	"section_key" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"section_link" jsonb,
	"job_id" uuid,
	"declined" boolean DEFAULT false NOT NULL,
	"label" jsonb,
	"rating" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_messages_role_check" CHECK ("assistant_messages"."role" in ('user', 'assistant')),
	CONSTRAINT "assistant_messages_rating_check" CHECK ("assistant_messages"."rating" is null or "assistant_messages"."rating" in ('helpful', 'not-helpful'))
);
--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_conversations_declaration_key" ON "assistant_conversations" USING btree ("declaration_id") WHERE "assistant_conversations"."declaration_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_conversations_person_without_draft_key" ON "assistant_conversations" USING btree ("person_id") WHERE "assistant_conversations"."declaration_id" is null;--> statement-breakpoint
CREATE INDEX "assistant_conversations_expires_at_idx" ON "assistant_conversations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_conversation_id_at_idx" ON "assistant_messages" USING btree ("conversation_id","at");