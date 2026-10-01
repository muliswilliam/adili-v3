CREATE TABLE "roster_exits" (
	"batch_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"exit_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_exits_batch_id_record_id_pk" PRIMARY KEY("batch_id","record_id")
);
--> statement-breakpoint
-- Existing versions start obligations on the date their Commission was created (Africa/Nairobi):
-- officers appointed before it joined Adili are assumed to have declared outside it.
ALTER TABLE "tenant_policy_versions" ADD COLUMN "obligations_start_date" date;--> statement-breakpoint
UPDATE "tenant_policy_versions" AS "version" SET "obligations_start_date" = ("commission"."created_at" AT TIME ZONE 'Africa/Nairobi')::date
FROM "commissions" AS "commission" WHERE "commission"."slug" = "version"."tenant";--> statement-breakpoint
ALTER TABLE "tenant_policy_versions" ALTER COLUMN "obligations_start_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_policy_versions" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "roster_exits" ADD CONSTRAINT "roster_exits_record_id_roster_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."roster_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_exits" ADD CONSTRAINT "roster_exits_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_exits_record_id_idx" ON "roster_exits" USING btree ("record_id");