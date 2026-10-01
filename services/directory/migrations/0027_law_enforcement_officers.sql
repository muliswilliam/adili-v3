CREATE TABLE "agencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_basis" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "agencies_code_pattern" CHECK ("agencies"."code" ~ '^[A-Z][A-Z0-9]{1,9}$')
);
--> statement-breakpoint
CREATE TABLE "law_enforcement_officers" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"agency_code" text NOT NULL,
	"state" text NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "law_enforcement_officers_state_check" CHECK ("law_enforcement_officers"."state" in ('invited', 'activated', 'revoked')),
	CONSTRAINT "law_enforcement_officers_activated_at_check" CHECK ("law_enforcement_officers"."state" <> 'activated' or "law_enforcement_officers"."activated_at" is not null),
	CONSTRAINT "law_enforcement_officers_revoked_at_check" CHECK (("law_enforcement_officers"."state" = 'revoked') = ("law_enforcement_officers"."revoked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "persons" ALTER COLUMN "national_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ALTER COLUMN "ofr" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "kind" text DEFAULT 'declarant' NOT NULL;--> statement-breakpoint
ALTER TABLE "law_enforcement_officers" ADD CONSTRAINT "law_enforcement_officers_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "law_enforcement_officers" ADD CONSTRAINT "law_enforcement_officers_agency_code_agencies_code_fk" FOREIGN KEY ("agency_code") REFERENCES "public"."agencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "law_enforcement_officers_agency_code_idx" ON "law_enforcement_officers" USING btree ("agency_code");--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_kind_check" CHECK ("persons"."kind" in ('declarant', 'law-enforcement'));--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_declarant_identity_check" CHECK ("persons"."kind" <> 'declarant' or ("persons"."national_id" is not null and "persons"."ofr" is not null));