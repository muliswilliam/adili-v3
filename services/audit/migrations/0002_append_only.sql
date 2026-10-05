-- The audit trail is append-only (ADR-008 "Storage and protection"): events and anchors are
-- never changed or removed, whoever connects, the table owner included. A chain head moves
-- forward only, by one event at a time.
CREATE FUNCTION audit_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit trail is append-only: % on % refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_anchors_append_only BEFORE UPDATE OR DELETE ON "audit_anchors"
  FOR EACH ROW EXECUTE FUNCTION audit_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_anchors_no_truncate BEFORE TRUNCATE ON "audit_anchors"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_change();
--> statement-breakpoint
CREATE FUNCTION audit_chain_head_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.tenant <> OLD.tenant OR NEW.chain_day <> OLD.chain_day
     OR NEW.seq <> OLD.seq + 1 THEN
    RAISE EXCEPTION 'audit chain head moves forward by one event only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_chain_heads_forward BEFORE UPDATE OR DELETE ON "audit_chain_heads"
  FOR EACH ROW EXECUTE FUNCTION audit_chain_head_forward();
--> statement-breakpoint
CREATE TRIGGER audit_chain_heads_no_truncate BEFORE TRUNCATE ON "audit_chain_heads"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_change();
