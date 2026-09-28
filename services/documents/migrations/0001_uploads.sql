CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant" text NOT NULL,
	"purpose" text NOT NULL,
	"state" text DEFAULT 'awaiting-upload' NOT NULL,
	"rejection" text,
	"threat" text,
	"declared_content_type" text NOT NULL,
	"detected_type" text,
	"declared_size" bigint NOT NULL,
	"size" bigint,
	"sha256" text,
	"file_name" text,
	"quarantine_key" text NOT NULL,
	"clean_key" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completion_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "uploads_quarantineKey_unique" UNIQUE("quarantine_key"),
	CONSTRAINT "uploads_state_check" CHECK ("uploads"."state" in ('awaiting-upload', 'clean', 'infected', 'rejected', 'expired')),
	CONSTRAINT "uploads_rejection_check" CHECK (("uploads"."state" = 'rejected') = ("uploads"."rejection" is not null) and ("uploads"."rejection" is null or "uploads"."rejection" in ('type', 'size', 'missing', 'timeout'))),
	CONSTRAINT "uploads_clean_check" CHECK (("uploads"."state" = 'clean') = ("uploads"."sha256" is not null and "uploads"."clean_key" is not null and "uploads"."size" is not null and "uploads"."detected_type" is not null)),
	CONSTRAINT "uploads_completed_at_check" CHECK (("uploads"."state" in ('clean', 'infected', 'rejected')) = ("uploads"."completed_at" is not null)),
	CONSTRAINT "uploads_declared_size_check" CHECK ("uploads"."declared_size" > 0)
);
--> statement-breakpoint
CREATE INDEX "uploads_awaiting_expires_at_idx" ON "uploads" USING btree ("expires_at") WHERE "uploads"."state" = 'awaiting-upload';