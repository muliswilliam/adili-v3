/**
 * Starts the fake directory inside the console's Node server, for `pnpm dev` only. Loaded by a
 * dynamic import behind `import.meta.env.DEV` in `src/server.ts`, so production builds never
 * contain it. Requests the handlers do not cover (for example `/v1/me`) reach the real directory.
 */
import { setupServer } from 'msw/node';

import { directoryHandlers } from './directory/handlers';

const started = Symbol.for('adili.console.directory-mocks');

export function startDirectoryMocks(baseUrl: string): void {
  const scope = globalThis as { [started]?: boolean };
  // Dev server reloads re-run the entry; one interceptor is enough.
  if (scope[started]) return;
  scope[started] = true;
  setupServer(...directoryHandlers(baseUrl)).listen({ onUnhandledRequest: 'bypass' });
  console.info(`[mocks] Directory Commission endpoints at ${baseUrl} are served by MSW fixtures.`);
}
