CREATE TABLE "obligation_drafts" (
	"obligation_id" uuid PRIMARY KEY NOT NULL,
	"declaration_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"person_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligation_drafts_declaration_id_key" UNIQUE("declaration_id")
);
--> statement-breakpoint
ALTER TABLE "roster_snapshots" ADD COLUMN "reporting_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "roster_snapshots" ADD COLUMN "reporting_entity_name" text;--> statement-breakpoint
ALTER TABLE "obligation_drafts" ADD CONSTRAINT "obligation_drafts_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Obligation drafts (#300): which obligations have a live draft, identifiers only. The declarant
-- writes their own rows (`app.person`) with the draft; the obligation's Commission reads them
-- (`app.tenant`) to count drafts in progress without ever reading a draft. FORCE applies the
-- policies to the service's own role, which owns the tables.
ALTER TABLE "obligation_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "obligation_drafts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "obligation_drafts_person" ON "obligation_drafts"
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid)
	WITH CHECK ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "obligation_drafts_tenant_read" ON "obligation_drafts" FOR SELECT
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- The drafts started before this migration: read past the declarant-only policies for the copy.
ALTER TABLE "declarations" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "obligation_drafts" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "obligation_drafts" ("obligation_id", "declaration_id", "tenant", "person_id", "started_at")
	SELECT "obligation_id", "id", "tenant", "person_id", "created_at" FROM "declarations" WHERE "status" = 'draft';
--> statement-breakpoint
ALTER TABLE "obligation_drafts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "declarations" FORCE ROW LEVEL SECURITY;
