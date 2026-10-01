import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { fixtureKey } from '../src/providers/replay.adapter.js';
import { SUITES } from './golden/suites.js';
import { evalModel, evalRequest } from './lib/run.js';

/**
 * Deletes eval fixtures no golden case requests any more. Record mode only adds files, so a prompt
 * edit or a removed case leaves the old ones behind. `pnpm eval:prune`.
 */

const FIXTURES_DIR = 'evals/fixtures';
const AI_MODEL = evalModel();

const wanted = new Set(
  SUITES.flatMap((suite) =>
    suite.cases.map((golden) => {
      const request = evalRequest(suite.task, golden.input, AI_MODEL);
      return `${fixtureKey('generateStructured', request)}.json`;
    }),
  ),
);

const files = (await readdir(FIXTURES_DIR).catch(() => [])).filter((file) =>
  file.endsWith('.json'),
);
const stale = files.filter((file) => !wanted.has(file));
await Promise.all(stale.map((file) => rm(join(FIXTURES_DIR, file))));
const missing = [...wanted].filter((file) => !files.includes(file)).length;
process.stdout.write(
  `Removed ${stale.length} stale fixtures; ${missing} of ${wanted.size} cases have none (run pnpm eval:record).\n`,
);
