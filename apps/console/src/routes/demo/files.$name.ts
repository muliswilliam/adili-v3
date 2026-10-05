import { createFileRoute } from '@tanstack/react-router';

import { demoFileResponse } from '../../server/demo/files.server';

/** A file the presenter uploads during the demo, from the stack itself (demo panel, #679). */
export const Route = createFileRoute('/demo/files/$name')({
  server: {
    handlers: {
      GET: ({ request, params }) => demoFileResponse(request, params.name),
    },
  },
});
