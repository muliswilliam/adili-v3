import { createFileRoute } from '@tanstack/react-router';

import { getBff } from '../../server/bff.server';

/**
 * Spec 06's step-up for the console's legal acts (Form M confirmation): a fresh one-time code,
 * then back to `returnTo` with `stepUp=done|failed`.
 */
export const Route = createFileRoute('/auth/step-up')({
  server: {
    handlers: {
      GET: ({ request }) => getBff().stepUp(request),
    },
  },
});
