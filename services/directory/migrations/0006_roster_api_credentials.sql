CREATE TABLE "roster_api_credentials" (
	"tenant" text PRIMARY KEY NOT NULL,
	"keycloak_client_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "roster_api_credentials" ADD CONSTRAINT "roster_api_credentials_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_api_credentials_keycloak_client_id_key" ON "roster_api_credentials" USING btree ("keycloak_client_id");