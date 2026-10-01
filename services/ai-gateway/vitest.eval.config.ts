import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const recording = process.env.AI_REPLAY_MODE === 'record';

/** In record mode the Anthropic key may come from the local, uncommitted .env. */
function localKey(): Record<string, string> {
  if (!recording || process.env.ANTHROPIC_API_KEY || !existsSync('.env')) return {};
  const { ANTHROPIC_API_KEY } = parseEnv(readFileSync('.env', 'utf8'));
  return ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY } : {};
}

// Task evals (spec 07c S9): golden inputs against recorded outputs in evals/fixtures. Replay needs
// no provider; `pnpm eval:record` refreshes the fixtures from Anthropic (see evals/README.md).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['evals/**/*.eval.ts'],
    // A recorded call can take most of a minute.
    testTimeout: recording ? 180_000 : 5_000,
    env: {
      AI_PROVIDER: 'replay',
      AI_FIXTURES_DIR: 'evals/fixtures',
      LOG_LEVEL: 'fatal',
      ...localKey(),
    },
  },
});
