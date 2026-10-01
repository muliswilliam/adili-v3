CREATE TABLE "reminder_messages" (
	"obligation_id" uuid NOT NULL,
	"offset_days" integer NOT NULL,
	"tenant" text NOT NULL,
	"params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_messages_obligation_id_offset_days_pk" PRIMARY KEY("obligation_id","offset_days")
);
--> statement-breakpoint
ALTER TABLE "reminder_messages" ADD CONSTRAINT "reminder_messages_obligation_id_filing_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."filing_obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A reminder's frozen message is tenant data like the reminder itself (0002): system transactions
-- see their tenant's rows, platform work every tenant's. FORCE applies the policy to the service's
-- own role, which owns the table.
ALTER TABLE "reminder_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reminder_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "reminder_messages_tenant_isolation" ON "reminder_messages"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
