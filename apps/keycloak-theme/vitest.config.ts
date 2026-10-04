import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    isolate: false,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Above the 5 s asyncUtilTimeout (vitest.setup.ts), so a findBy that waits the full 5 s fails
    // with Testing Library's DOM dump instead of a bare test timeout, and two awaits both fit.
    testTimeout: 20_000,
  },
});
