import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Component tests opt into jsdom with a `@vitest-environment jsdom` comment.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Each file mocks the router with its own spies, so files keep their own modules; the VM
    // pool does that while creating jsdom once per worker (`isolate: false` breaks the mocks).
    pool: 'vmThreads',
    // Above the 5 s asyncUtilTimeout (vitest.setup.ts), so a findBy that waits the full 5 s fails
    // with Testing Library's DOM dump instead of a bare test timeout, and two awaits both fit.
    testTimeout: 20_000,
  },
});
