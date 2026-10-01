import { createFileRoute } from '@tanstack/react-router';

import { getBff } from '../../server/bff.server';

/** Spec 06: a fresh one-time code before submission, back to `returnTo` with `stepUp=done|failed`. */
export const Route = createFileRoute('/auth/step-up')({
  server: {
    handlers: {
      GET: ({ request }) => getBff().stepUp(request),
    },
  },
});
