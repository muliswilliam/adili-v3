import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Component tests opt into jsdom with a `@vitest-environment jsdom` comment.
  test: { include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['./vitest.setup.ts'] },
});
