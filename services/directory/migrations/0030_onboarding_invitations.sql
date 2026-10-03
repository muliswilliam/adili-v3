CREATE TABLE "onboarding_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant" text NOT NULL,
	"roster_record_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_by" text NOT NULL,
	"channels" jsonb NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_invitations" ADD CONSTRAINT "onboarding_invitations_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_invitations" ADD CONSTRAINT "onboarding_invitations_roster_record_id_roster_records_id_fk" FOREIGN KEY ("roster_record_id") REFERENCES "public"."roster_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_invitations_key_idx" ON "onboarding_invitations" USING btree ("tenant","idempotency_key");--> statement-breakpoint
CREATE INDEX "onboarding_invitations_record_idx" ON "onboarding_invitations" USING btree ("roster_record_id","sent_at");--> statement-breakpoint
-- Tenant isolation, as every roster table (migration 0009).
ALTER TABLE "onboarding_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "onboarding_invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "onboarding_invitations_tenant_isolation" ON "onboarding_invitations"
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');