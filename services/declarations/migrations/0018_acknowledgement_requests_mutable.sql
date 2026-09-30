-- The slip's verify URL and the declarant's ask for the slip again (ack_verify_url and
-- ack_requested_at, migration 0017) follow the legal act like the rest of the acknowledgement:
-- the insert-only trigger of migration 0016 lets them change too. Everything else stays as 0016
-- made it.
CREATE OR REPLACE FUNCTION "declaration_versions_insert_only"() RETURNS trigger LANGUAGE plpgsql AS $$
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
