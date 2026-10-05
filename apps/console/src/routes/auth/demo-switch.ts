import { createFileRoute } from '@tanstack/react-router';

import { getDemoSwitch } from '../../server/demo/demo.server';

/** The demo role switcher's form post (#616); not found outside demo mode. */
export const Route = createFileRoute('/auth/demo-switch')({
  server: {
    handlers: {
      POST: ({ request }) => {
        const demo = getDemoSwitch();
        return demo ? demo.switchAccount(request) : new Response('Not found', { status: 404 });
      },
    },
  },
});
