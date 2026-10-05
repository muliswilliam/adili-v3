import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * #371: demo-only code is refused in production. The demo scripts write what no API changes
 * (the platform cycle calendar), so they must stop before they touch a database when
 * NODE_ENV is production. The database URL points nowhere: a script that got past its guard
 * would fail on the connection instead, with another message.
 */
async function runInProduction(script: string, args: string[]): Promise<string> {
  try {
    await run(
      'node',
      ['--disable-warning=DEP0205', '--import', '@swc-node/register/esm-register', script, ...args],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
        },
      },
    );
  } catch (error) {
    return (error as { stderr: string }).stderr;
  }
  throw new Error(`${script} ran in production`);
}

describe('demo scripts in production', () => {
  it.each([['src/db/demo-cycles.ts', ['2024,2026', '400']]])(
    '%s refuses to run',
    async (script, args) => {
      expect(await runInProduction(script, args)).toMatch(/not in production/);
    },
    30_000,
  );
});
