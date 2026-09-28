-- Narrows the cross-Commission national ID lookup of migration 0019 (import notes on officers who
-- are on two rosters, spec #27) to what the note needs:
-- * one boolean per national ID asked about, in order: no IDs, Commissions or records come back;
-- * the importing tenant is the caller's own RLS context (`app.tenant`), not an argument, so a
--   session cannot ask on behalf of another Commission, and outside a tenant context (none, or
--   `platform`) it refuses;
-- * the caller's context is the same after the call, error or not: the platform context lasts for
--   the one query, and a failure aborts the caller's (sub)transaction, which rolls the setting
--   back with it;
-- * SECURITY DEFINER with its search_path pinned to the catalog, the schema it is created in and
--   pg_temp last, so it runs as its owner (the directory's role, whose tables FORCE row level
--   security) whoever calls it, and no caller's schema or temporary table can stand in for
--   roster_records; EXECUTE is revoked from PUBLIC, leaving the owner, which the service connects
--   as (one role per service database, infra/compose/postgres/init-databases.sh).
DROP FUNCTION roster_national_ids_on_other_rosters(text, text[]);
--> statement-breakpoint
CREATE FUNCTION roster_national_ids_on_other_rosters(national_ids text[])
RETURNS boolean[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  caller_tenant text := coalesce(current_setting('app.tenant', true), '');
  found boolean[];
BEGIN
  IF caller_tenant IN ('', 'platform') THEN
    RAISE EXCEPTION 'roster_national_ids_on_other_rosters runs in a Commission''s context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.tenant', 'platform', true);
  SELECT coalesce(array_agg(
    EXISTS (
      SELECT 1
      FROM roster_records AS r
      WHERE r.national_id = input.national_id
        AND r.tenant <> caller_tenant
        AND r.state <> 'exited'
    )
    ORDER BY input.position
  ), '{}')
  INTO found
  FROM unnest(national_ids) WITH ORDINALITY AS input(national_id, position);
  PERFORM set_config('app.tenant', caller_tenant, true);
  RETURN found;
END
$$;
--> statement-breakpoint
-- The schema the migrations run in: public in the service, a private schema per test suite.
DO $$
BEGIN
  EXECUTE format(
    'ALTER FUNCTION roster_national_ids_on_other_rosters(text[]) SET search_path = pg_catalog, %I, pg_temp',
    current_schema()
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION roster_national_ids_on_other_rosters(text[]) FROM PUBLIC;
