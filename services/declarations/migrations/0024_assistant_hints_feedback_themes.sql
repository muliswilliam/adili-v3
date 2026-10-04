CREATE TABLE "assistant_hint_cache" (
	"residual_hash" text NOT NULL,
	"language" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"hints" jsonb NOT NULL,
	"label" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_hint_cache_residual_hash_language_prompt_version_pk" PRIMARY KEY("residual_hash","language","prompt_version")
);
--> statement-breakpoint
CREATE TABLE "assistant_theme_counts" (
	"tenant" text NOT NULL,
	"month" text NOT NULL,
	"theme" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"unanswered" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assistant_theme_counts_tenant_month_theme_pk" PRIMARY KEY("tenant","month","theme"),
	CONSTRAINT "assistant_theme_counts_month_check" CHECK ("assistant_theme_counts"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "assistant_theme_counts_unanswered_check" CHECK ("assistant_theme_counts"."unanswered" >= 0 and "assistant_theme_counts"."unanswered" <= "assistant_theme_counts"."count")
);
--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "feedback_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "feedback_envelope" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "theme" text;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_feedback_check" CHECK (("assistant_messages"."feedback_ciphertext" is null) = ("assistant_messages"."feedback_envelope" is null));