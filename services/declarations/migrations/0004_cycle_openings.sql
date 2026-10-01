CREATE TABLE "cycle_openings" (
	"tenant" text NOT NULL,
	"cycle_year" integer NOT NULL,
	"obligations_created" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_openings_tenant_cycle_year_pk" PRIMARY KEY("tenant","cycle_year")
);
--> statement-breakpoint
CREATE INDEX "roster_snapshots_tenant_id_idx" ON "roster_snapshots" USING btree ("tenant","roster_record_id");