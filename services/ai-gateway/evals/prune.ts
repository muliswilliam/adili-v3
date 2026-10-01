import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { providerEnvSchema } from '../src/providers/provider-env.js';
import { fixtureKey } from '../src/providers/replay.adapter.js';
import { buildProviderRequest } from '../src/tasks/provider-request.js';
import { SUITES } from './golden/suites.js';

/**
 * Deletes eval fixtures no golden case requests any more. Record mode only adds files, so a prompt
 * edit or a removed case leaves the old ones behind. `pnpm eval:prune`.
 */

const FIXTURES_DIR = 'evals/fixtures';
const { AI_MODEL } = providerEnvSchema.parse(process.env);

const wanted = new Set(
  SUITES.flatMap((suite) =>
    suite.cases.map((golden) => {
      const input = suite.task.input.parse(golden.input);
      const request = buildProviderRequest(
        suite.task,
        suite.task.currentPromptVersion,
        input,
        AI_MODEL,
      );
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
