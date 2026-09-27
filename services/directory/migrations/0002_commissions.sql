CREATE TABLE "commission_categories" (
	"commission_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	CONSTRAINT "commission_categories_commission_id_category_code_pk" PRIMARY KEY("commission_id","category_code")
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commissions_slug_unique" UNIQUE("slug"),
	CONSTRAINT "commissions_slug_pattern" CHECK ("commissions"."slug" ~ '^[a-z][a-z0-9]{1,19}$'),
	CONSTRAINT "commissions_type_check" CHECK ("commissions"."type" in ('hosted', 'federated')),
	CONSTRAINT "commissions_status_check" CHECK ("commissions"."status" in ('active'))
);
--> statement-breakpoint
CREATE TABLE "officer_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"citation" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "officer_categories_sort_order_unique" UNIQUE("sort_order")
);
--> statement-breakpoint
CREATE TABLE "reporting_officer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"commission_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"keycloak_user_id" text NOT NULL,
	"state" text NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"replaced_at" timestamp with time zone,
	"replaced_by" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporting_officer_assignments_state_check" CHECK ("reporting_officer_assignments"."state" in ('invited', 'activated', 'replaced'))
);
--> statement-breakpoint
CREATE TABLE "tenant_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant" text NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_policy_versions_tenant_version_unique" UNIQUE("tenant","version")
);
--> statement-breakpoint
ALTER TABLE "commission_categories" ADD CONSTRAINT "commission_categories_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_categories" ADD CONSTRAINT "commission_categories_category_code_officer_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."officer_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_officer_assignments" ADD CONSTRAINT "reporting_officer_assignments_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_officer_assignments" ADD CONSTRAINT "reporting_officer_assignments_replaced_by_reporting_officer_assignments_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."reporting_officer_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_policy_versions" ADD CONSTRAINT "tenant_policy_versions_tenant_commissions_slug_fk" FOREIGN KEY ("tenant") REFERENCES "public"."commissions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_name_lower_key" ON "commissions" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_officer_assignments_current_key" ON "reporting_officer_assignments" USING btree ("commission_id") WHERE "reporting_officer_assignments"."state" <> 'replaced';--> statement-breakpoint
CREATE INDEX "reporting_officer_assignments_keycloak_user_id_idx" ON "reporting_officer_assignments" USING btree ("keycloak_user_id");