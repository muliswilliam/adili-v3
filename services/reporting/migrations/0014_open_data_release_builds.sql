CREATE TABLE "open_data_release_builds" (
	"release_id" uuid PRIMARY KEY NOT NULL,
	"fy" integer NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"built_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "open_data_release_builds_fy_kind_building_key" ON "open_data_release_builds" USING btree ("fy","kind") WHERE "open_data_release_builds"."status" = 'building';--> statement-breakpoint
-- Release builds are EACC's, as its releases are: EACC and platform read and write them; a
-- Commission's context sees none.
ALTER TABLE "open_data_release_builds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "open_data_release_builds" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "open_data_release_builds_eacc" ON "open_data_release_builds"
	USING (current_setting('app.tenant', true) IN ('eacc', 'platform'))
	WITH CHECK (current_setting('app.tenant', true) IN ('eacc', 'platform'));
