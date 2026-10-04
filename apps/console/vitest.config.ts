import { maxWorkers } from '@adili/vitest-config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: maxWorkers(),
    // Component tests opt into jsdom with a `@vitest-environment jsdom` comment.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Each file mocks the router with its own spies, so files keep their own modules; the VM
    // pool does that while creating jsdom once per worker (`isolate: false` breaks the mocks).
    pool: 'vmThreads',
  },
});
