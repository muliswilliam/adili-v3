import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    isolate: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts'],
  },
});
