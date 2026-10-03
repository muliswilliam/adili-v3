ALTER TABLE "certified_copies" ADD COLUMN "commission_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "certified_copies" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "certified_copies" ADD COLUMN "requested_by_name" text;