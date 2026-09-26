CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"template" text NOT NULL,
	"locale" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"tenant" text,
	"caller" text,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "messages_recipient_idx" ON "messages" USING btree ("recipient_hash","created_at");