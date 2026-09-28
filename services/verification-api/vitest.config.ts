import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emits the decorator metadata Nest's dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    isolate: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Config is validated at import; tests use the committed local defaults.
    env: { ...parseEnv(readFileSync('.env.example', 'utf8')), LOG_LEVEL: 'fatal' },
  },
});
