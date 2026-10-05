CREATE TABLE "audit_anchors" (
	"tenant" text NOT NULL,
	"chain_day" date NOT NULL,
	"event_count" integer NOT NULL,
	"head_hash" text NOT NULL,
	"merkle_root" text NOT NULL,
	"key_name" text NOT NULL,
	"key_version" integer NOT NULL,
	"signature" text NOT NULL,
	"object_key" text NOT NULL,
	"anchored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_anchors_tenant_chain_day_pk" PRIMARY KEY("tenant","chain_day")
);
--> statement-breakpoint
CREATE TABLE "audit_chain_heads" (
	"tenant" text NOT NULL,
	"chain_day" date NOT NULL,
	"seq" integer NOT NULL,
	"head_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_chain_heads_tenant_chain_day_pk" PRIMARY KEY("tenant","chain_day")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"tenant" text NOT NULL,
	"chain_day" date NOT NULL,
	"seq" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_client_id" text,
	"actor_tenant" text,
	"actor_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"on_behalf_of" text,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"subject_person_id" text,
	"outcome" text NOT NULL,
	"legal_basis" text,
	"legal_reference" text,
	"recipient" text,
	"request_method" text,
	"request_route" text,
	"traceparent" text,
	"envelope" jsonb NOT NULL,
	"hash_v" smallint NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_tenant_chain_day_seq_pk" PRIMARY KEY("tenant","chain_day","seq"),
	CONSTRAINT "audit_events_seq_positive" CHECK ("audit_events"."seq" > 0),
	CONSTRAINT "audit_events_kind" CHECK ("audit_events"."kind" in ('read', 'write', 'verification', 'auth'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_event_id_idx" ON "audit_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_subject_person_idx" ON "audit_events" USING btree ("subject_person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action","occurred_at");