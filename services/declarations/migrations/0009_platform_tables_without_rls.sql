-- The two platform-level tables have no row-level security, by design (ADR-006): they hold no
-- tenant's data. commission_refs names every Commission (slug, issuer code, name: public facts)
-- and when its latest roster import completed, which the national summary lists for EACC;
-- cycle_calendar is the statutory biennial calendar. Every other table holding obligations data
-- is tenant-scoped (migrations 0002, 0005, 0007); outbox and inbox are the service's plumbing.
COMMENT ON TABLE "commission_refs" IS 'Platform-level, no RLS: public Commission references (slug, issuer code, name) and last roster import time. See migration 0009.';
--> statement-breakpoint
COMMENT ON TABLE "cycle_calendar" IS 'Platform-level, no RLS: the statutory biennial cycle calendar. See migration 0009.';
