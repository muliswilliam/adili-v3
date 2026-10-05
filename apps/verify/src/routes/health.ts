import { createFileRoute } from '@tanstack/react-router';

import { mocksOn } from '../server/mocks-on.server';

/** Liveness for `pnpm health`, with the mocks that are on, so a deployment can be checked (#615). */
export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      GET: () => Response.json({ status: 'up', mocks: mocksOn() }),
    },
  },
});
