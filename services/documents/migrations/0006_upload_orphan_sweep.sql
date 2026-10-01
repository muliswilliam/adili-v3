ALTER TABLE "uploads" DROP CONSTRAINT "uploads_state_check";--> statement-breakpoint
ALTER TABLE "uploads" DROP CONSTRAINT "uploads_completed_at_check";--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "linked_by" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "unlinked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "uploads_orphaned_since_idx" ON "uploads" USING btree (coalesce("unlinked_at", "completed_at")) WHERE "uploads"."state" = 'clean' and "uploads"."linked_at" is null;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_deleted_at_check" CHECK (("uploads"."state" = 'deleted') = ("uploads"."deleted_at" is not null));--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_linked_by_check" CHECK (("uploads"."linked_at" is null) = ("uploads"."linked_by" is null));--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_state_check" CHECK ("uploads"."state" in ('awaiting-upload', 'clean', 'infected', 'rejected', 'expired', 'deleted'));--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_completed_at_check" CHECK (("uploads"."state" in ('clean', 'infected', 'rejected', 'deleted')) = ("uploads"."completed_at" is not null));