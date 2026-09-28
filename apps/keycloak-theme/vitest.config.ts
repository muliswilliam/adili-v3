import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    isolate: false,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
