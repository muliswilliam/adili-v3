-- Submitted versions and their items (spec 06), migration 0015 made them list-partitioned by
-- cycle year (the statement date's year, ADR-001). One partition per year of the biennial
-- calendar and the years around it; a default partition takes any other year (an initial or final
-- declaration dated outside them) so a submission never fails for want of a partition. Add a
-- year's partitions before its cycle opens and move its rows out of the default then.
CREATE TABLE "declaration_versions_2026" PARTITION OF "declaration_versions" FOR VALUES IN (2026);
--> statement-breakpoint
CREATE TABLE "declaration_versions_2027" PARTITION OF "declaration_versions" FOR VALUES IN (2027);
--> statement-breakpoint
CREATE TABLE "declaration_versions_2028" PARTITION OF "declaration_versions" FOR VALUES IN (2028);
--> statement-breakpoint
CREATE TABLE "declaration_versions_2029" PARTITION OF "declaration_versions" FOR VALUES IN (2029);
--> statement-breakpoint
CREATE TABLE "declaration_versions_2030" PARTITION OF "declaration_versions" FOR VALUES IN (2030);
--> statement-breakpoint
CREATE TABLE "declaration_versions_2031" PARTITION OF "declaration_versions" FOR VALUES IN (2031);
--> statement-breakpoint
CREATE TABLE "declaration_versions_default" PARTITION OF "declaration_versions" DEFAULT;
--> statement-breakpoint
CREATE TABLE "declaration_items_2026" PARTITION OF "declaration_items" FOR VALUES IN (2026);
--> statement-breakpoint
CREATE TABLE "declaration_items_2027" PARTITION OF "declaration_items" FOR VALUES IN (2027);
--> statement-breakpoint
CREATE TABLE "declaration_items_2028" PARTITION OF "declaration_items" FOR VALUES IN (2028);
--> statement-breakpoint
CREATE TABLE "declaration_items_2029" PARTITION OF "declaration_items" FOR VALUES IN (2029);
--> statement-breakpoint
CREATE TABLE "declaration_items_2030" PARTITION OF "declaration_items" FOR VALUES IN (2030);
--> statement-breakpoint
CREATE TABLE "declaration_items_2031" PARTITION OF "declaration_items" FOR VALUES IN (2031);
--> statement-breakpoint
CREATE TABLE "declaration_items_default" PARTITION OF "declaration_items" DEFAULT;
--> statement-breakpoint
-- Insert-only (S21): a submitted version is the legal record. No DELETE; an UPDATE may change only
-- what follows the legal act: supersession (set once, never cleared or moved), the acknowledgement
-- (ack_*) and the verified count. Anything else, the snapshot and the partition key included, is
-- refused. The trigger is on the partitioned table, so every partition has it.
CREATE FUNCTION "declaration_versions_insert_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	mutable CONSTANT text[] := ARRAY['superseded_at', 'ack_status', 'ack_document_id', 'ack_verification_id', 'ack_verify_url', 'ack_issued_at', 'ack_requested_at', 'verified_count'];
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'declaration_versions is insert-only: a submitted version cannot be deleted'
			USING ERRCODE = 'insufficient_privilege';
	END IF;
	IF OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at THEN
		RAISE EXCEPTION 'declaration_versions is insert-only: superseded_at is set once'
			USING ERRCODE = 'insufficient_privilege';
	END IF;
	IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
		RAISE EXCEPTION 'declaration_versions is insert-only: only superseded_at, ack_* and verified_count may change'
			USING ERRCODE = 'insufficient_privilege';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "declaration_versions_insert_only" BEFORE UPDATE OR DELETE ON "declaration_versions"
	FOR EACH ROW EXECUTE FUNCTION "declaration_versions_insert_only"();
--> statement-breakpoint
-- Items never change after insert.
CREATE FUNCTION "declaration_items_insert_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'declaration_items is insert-only: a submitted item cannot be updated or deleted'
		USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "declaration_items_insert_only" BEFORE UPDATE OR DELETE ON "declaration_items"
	FOR EACH ROW EXECUTE FUNCTION "declaration_items_insert_only"();
--> statement-breakpoint
-- Row-level security (ADR-018 §2): the declarant reads their own versions and items through
-- `app.person` (`withPerson`), across Commissions, and never writes through the person axis. The
-- submit transaction writes the version and its items in the Commission's context (`app.tenant`,
-- switched to the declaration's tenant after the declarant's own rows are checked); the
-- acknowledgement and the verified count follow the legal act there or as `platform`. A reset
-- setting reads back as '' on a pooled connection, hence nullif. FORCE applies the policies to
-- the service's own role, which owns the tables.
ALTER TABLE "declaration_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "declaration_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "declaration_versions_person_read" ON "declaration_versions" FOR SELECT
	USING ("person_id" = nullif(current_setting('app.person', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "declaration_versions_tenant_read" ON "declaration_versions" FOR SELECT
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "declaration_versions_tenant_insert" ON "declaration_versions" FOR INSERT
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "declaration_versions_tenant_update" ON "declaration_versions" FOR UPDATE
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform')
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "declaration_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "declaration_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The items of the versions the person may read (the subquery is itself under RLS).
CREATE POLICY "declaration_items_person_read" ON "declaration_items" FOR SELECT
	USING (EXISTS (
		SELECT 1 FROM "declaration_versions" v
		WHERE v."id" = "declaration_items"."version_id" AND v."cycle_year" = "declaration_items"."cycle_year"
			AND v."person_id" = nullif(current_setting('app.person', true), '')::uuid
	));
--> statement-breakpoint
CREATE POLICY "declaration_items_tenant_read" ON "declaration_items" FOR SELECT
	USING ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
CREATE POLICY "declaration_items_tenant_insert" ON "declaration_items" FOR INSERT
	WITH CHECK ("tenant" = current_setting('app.tenant', true) OR current_setting('app.tenant', true) = 'platform');
--> statement-breakpoint
-- Platform-level service plumbing, no row-level security (ADR-006), as in the directory: the
-- reference counters hold sequence values per (scheme, Commission, year), no tenant's data, and
-- the idempotency store is keyed by the caller's token subject.
COMMENT ON TABLE "numbering_counters" IS 'Platform-level, no RLS: gapless reference counters (ADR-011). See migration 0016.';
--> statement-breakpoint
COMMENT ON TABLE "idempotency_keys" IS 'Service plumbing, no RLS: stored results of Idempotency-Key requests (ADR-009). See migration 0016.';
