import { createFileRoute } from '@tanstack/react-router';

import { getDemoSwitch } from '../../server/demo/demo.server';

/**
 * The presentation deck's deep link (`?as=<demo key>&next=<path>`): signs in as a demo account and
 * lands on a view, so a slide can embed it. Not found outside demo mode.
 */
export const Route = createFileRoute('/auth/demo-enter')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const demo = getDemoSwitch();
        return demo ? demo.enter(request) : new Response('Not found', { status: 404 });
      },
    },
  },
});
