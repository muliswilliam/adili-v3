ALTER TABLE "lea_requests" ADD COLUMN "package_kind" text;--> statement-breakpoint
ALTER TABLE "lea_requests" ADD COLUMN "package_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "package_kind" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "package_failed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "lea_requests" SET "package_kind" = 'access-package' WHERE "package_document_id" IS NOT NULL;--> statement-breakpoint
UPDATE "access_requests" SET "package_kind" = 'access-package' WHERE "package_document_id" IS NOT NULL;
