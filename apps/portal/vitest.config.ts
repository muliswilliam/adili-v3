import { hugeiconsPerIcon } from '@adili/ui/vitest.icons';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Loads only the icons a test renders; see the plugin for why.
  plugins: [hugeiconsPerIcon()],
  // Component tests opt into jsdom with a `@vitest-environment jsdom` comment.
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Backstop only: the first render in a jsdom file also pays for React and the DOM warming up,
    // which on a heavily loaded machine can pass the 5s default. Import cost is fixed above.
    testTimeout: 20_000,
  },
});
