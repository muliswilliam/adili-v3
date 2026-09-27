import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Component tests opt into jsdom per file (`@vitest-environment jsdom`).
    setupFiles: ['./vitest.setup.ts'],
  },
});
