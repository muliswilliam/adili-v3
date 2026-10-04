import { maxWorkers } from '@adili/vitest-config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: maxWorkers(),
    isolate: false,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
