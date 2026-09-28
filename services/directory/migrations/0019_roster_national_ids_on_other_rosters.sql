-- Which of the given national IDs are on another Commission's roster (records not exited), for the
-- import's note on such rows: the same person may be on two rosters (transfers, spec #27), which
-- is allowed and noted. Import chunks run in the importing tenant's RLS context, which hides
-- other tenants' records, so the function reads in the platform context and puts the caller's
-- context back before it returns (an error aborts the caller's transaction, context and all). It
-- returns only the IDs asked about: nothing of the other roster (which Commission, which record)
-- reaches the importer.
CREATE FUNCTION roster_national_ids_on_other_rosters(importing_tenant text, national_ids text[])
RETURNS SETOF text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  caller_tenant text := coalesce(current_setting('app.tenant', true), '');
BEGIN
  PERFORM set_config('app.tenant', 'platform', true);
  RETURN QUERY
    SELECT DISTINCT r.national_id
    FROM roster_records AS r
    WHERE r.national_id = ANY (national_ids)
      AND r.tenant <> importing_tenant
      AND r.state <> 'exited';
  PERFORM set_config('app.tenant', caller_tenant, true);
END
$$;
