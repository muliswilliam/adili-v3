DROP INDEX "roster_records_tenant_state_idx";--> statement-breakpoint
CREATE INDEX "roster_records_tenant_summary_idx" ON "roster_records" USING btree ("tenant","state","absent_from_latest_import");