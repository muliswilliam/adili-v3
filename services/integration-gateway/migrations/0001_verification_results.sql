CREATE TABLE "verification_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"system" text NOT NULL,
	"subject_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"cached" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"caller" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "verification_results_system_checked_idx" ON "verification_results" USING btree ("system","checked_at");--> statement-breakpoint
CREATE INDEX "verification_results_subject_idx" ON "verification_results" USING btree ("subject_hash","checked_at");