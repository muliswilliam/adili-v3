import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';

/**
 * ADR-006: every tenant-scoped directory table is isolated by Postgres row-level security, forced
 * on the owning role the service connects as, with a policy on the transaction's `app.tenant`.
 * A table is tenant-scoped when it has a `tenant` column.
 */

interface TableSecurity extends Record<string, unknown> {
  table: string;
  enabled: boolean;
  forced: boolean;
  policies: string[];
}

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

describe('directory schema', () => {
  it('has row-level security enabled, forced and keyed on app.tenant for every tenant-scoped table', async () => {
    const result = await api.db.execute<TableSecurity>(sql`
      select c.relname as "table",
             c.relrowsecurity as "enabled",
             c.relforcerowsecurity as "forced",
             coalesce(
               array_agg(p.polname::text) filter (
                 where pg_get_expr(p.polqual, p.polrelid) like '%app.tenant%'
                   and pg_get_expr(p.polwithcheck, p.polrelid) like '%app.tenant%'
               ),
               '{}'
             ) as "policies"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = current_schema()
        and c.relkind = 'r'
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = n.nspname and col.table_name = c.relname
            and col.column_name = 'tenant'
        )
      group by c.relname, c.relrowsecurity, c.relforcerowsecurity
      order by c.relname
    `);
    const tables = result.rows;

    expect(tables.map((row) => row.table)).toEqual(
      expect.arrayContaining(['roster_import_batches', 'tenant_policy_versions']) as string[],
    );
    const unprotected = tables.filter(
      (row) => !row.enabled || !row.forced || row.policies.length === 0,
    );
    expect(unprotected).toEqual([]);
  });
});
