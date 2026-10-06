import { createFileRoute } from '@tanstack/react-router';

import { demoVerifyFileResponse } from '../../server/demo/verify.server';

/** A file the seed wrote beside its verify codes, the tampered slip (demo panel). */
export const Route = createFileRoute('/demo/verify-files/$name')({
  server: {
    handlers: {
      GET: ({ request, params }) => demoVerifyFileResponse(request, params.name),
    },
  },
});
