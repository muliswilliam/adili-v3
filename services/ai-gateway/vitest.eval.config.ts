import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { maxWorkers } from '@adili/vitest-config';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const recording = process.env.AI_REPLAY_MODE === 'record';

/** In record mode the provider key and endpoint may come from the local, uncommitted .env. */
function localProvider(): Record<string, string> {
  if (!recording || process.env.ANTHROPIC_API_KEY || !existsSync('.env')) return {};
  const local = parseEnv(readFileSync('.env', 'utf8'));
  const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_STRUCTURED_OUTPUT'] as const;
  return Object.fromEntries(keys.flatMap((key) => (local[key] ? [[key, local[key]]] : [])));
}

// Task evals (spec 07c S9): golden inputs against recorded outputs in evals/fixtures. Replay needs
// no provider; `pnpm eval:record` refreshes the fixtures from Anthropic (see evals/README.md).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    maxWorkers: maxWorkers(),
    include: ['evals/**/*.eval.ts'],
    // A recorded call can take most of a minute.
    testTimeout: recording ? 180_000 : 5_000,
    env: {
      AI_PROVIDER: 'replay',
      AI_FIXTURES_DIR: 'evals/fixtures',
      LOG_LEVEL: 'fatal',
      // Long answers (a household summary in Swahili) outlast the service's 60 s provider timeout.
      ...(recording && { AI_PROVIDER_TIMEOUT_MS: '170000' }),
      ...localProvider(),
    },
  },
});
