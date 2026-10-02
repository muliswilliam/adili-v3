-- Audit records are append-only (ADR-008): what was recorded is never changed or removed.
CREATE FUNCTION "audit_records_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit records are append-only' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_records_append_only" BEFORE UPDATE OR DELETE ON "audit_records"
	FOR EACH ROW EXECUTE FUNCTION "audit_records_append_only"();
