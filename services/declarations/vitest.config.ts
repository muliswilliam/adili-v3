import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { maxWorkers } from '@adili/vitest-config';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emits the decorator metadata Nest's dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    maxWorkers: maxWorkers(),
    isolate: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts'],
    // A workflow test's first run bundles the workflow code (seconds, more under a parallel turbo
    // run), which the 5 s default does not always allow.
    testTimeout: 30_000,
    // Config is validated at import; tests use the committed local defaults.
    env: { ...parseEnv(readFileSync('.env.example', 'utf8')), LOG_LEVEL: 'fatal' },
  },
});
