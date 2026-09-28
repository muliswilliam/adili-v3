CREATE TABLE "roster_import_batches" (
	"import_id" uuid PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"rows" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roster_imports" ADD COLUMN "exits_recorded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_import_batches" ADD CONSTRAINT "roster_import_batches_import_id_roster_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."roster_imports"("id") ON DELETE cascade ON UPDATE no action;