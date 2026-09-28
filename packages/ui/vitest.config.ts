import { defineConfig } from 'vitest/config';

import { hugeiconsPerIcon } from './vitest.icons';

export default defineConfig({
  plugins: [hugeiconsPerIcon()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Backstop only: the first render in a jsdom file also pays for React and the DOM warming up,
    // which on a heavily loaded machine can pass the 5s default. Import cost is fixed above.
    testTimeout: 20_000,
  },
});
