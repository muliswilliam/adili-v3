ALTER TABLE "audit_records" ADD COLUMN "violations" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "violations" jsonb;