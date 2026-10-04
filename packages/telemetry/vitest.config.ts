import { maxWorkers } from '@adili/vitest-config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: maxWorkers(),
  },
});
