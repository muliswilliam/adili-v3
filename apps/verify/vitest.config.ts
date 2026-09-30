import { hugeiconsPerIcon } from '@adili/ui/vitest.icons';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Loads only the icons a test renders; see the plugin for why.
  plugins: [hugeiconsPerIcon()],
  test: {
    // Component tests opt into jsdom with a `@vitest-environment jsdom` comment.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Files mock the router with their own spies, so each keeps its own modules (see the portal).
    pool: 'vmThreads',
    testTimeout: 20_000,
  },
});
