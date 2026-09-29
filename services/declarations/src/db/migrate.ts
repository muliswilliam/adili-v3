import { createDatabase, runMigrations } from '@adili/data-access';

import { config, SERVICE_NAME } from '../config.js';
import { loadCorpus } from '../help/corpus.js';
import { runCorpusImport } from '../help/corpus-importer.js';
import { schema } from './schema.js';

await runMigrations(config.DATABASE_URL, new URL('../../migrations', import.meta.url).pathname);
console.log('declarations: migrations applied');

// The legal corpus is data the migrations' tables hold; importing an unchanged corpus is a no-op.
const db = createDatabase({
  url: config.DATABASE_URL,
  schema,
  applicationName: `${SERVICE_NAME}-migrate`,
});
try {
  const result = await runCorpusImport(db, loadCorpus());
  console.log(
    result.skipped
      ? 'declarations: corpus unchanged'
      : `declarations: corpus imported (${String(result.inserted)} inserted, ${String(result.updated)} updated, ${String(result.removed)} removed)`,
  );
} finally {
  await db.$client.end();
}
