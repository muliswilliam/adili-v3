/**
 * `pnpm --filter @adili/demo-seed fingerprint`: row counts of every domain table of the services'
 * databases and the mocks, one line each, so two runs can be diffed: a second `pnpm demo:seed`
 * must leave them as they were. Message plumbing (outbox, inbox), idempotency records, audit
 * records of reads and AI jobs are left out: reading the state, as the seed does to decide what
 * is missing, adds to them by design.
 */
import pg from 'pg';

import { loadConfig } from './config.js';

const DATABASES = [
  'adili_directory',
  'adili_declarations',
  'adili_review',
  'adili_access',
  'adili_reporting',
  'adili_documents',
  'adili_verification',
  'adili_notifications',
  'mocks',
];

const VOLATILE = /^(outbox|inbox|idempotency_keys|audit_records|jobs|.*_audit|django_session)$/;

const config = loadConfig();
for (const database of DATABASES) {
  const url = new URL(config.DEMO_FINGERPRINT_DATABASE_URL);
  url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const tables = await client.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
       order by 1`,
    );
    for (const { name } of tables.rows) {
      if (VOLATILE.test(name)) continue;
      const { rows } = await client.query<{ count: string }>(`select count(*) from "${name}"`);
      console.log(`${database}.${name} ${rows[0]?.count ?? '0'}`);
    }
  } finally {
    await client.end();
  }
}
