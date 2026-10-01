ALTER TABLE "self_access_applications" ALTER COLUMN "delivery_method" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "self_access_applications" ADD COLUMN "declarant_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "self_access_applications" ADD COLUMN "personnel_file_number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "self_access_applications" ADD COLUMN "declaration_reference" text NOT NULL;--> statement-breakpoint
ALTER TABLE "self_access_applications" ADD COLUMN "delivered_by" text;