import { createFileRoute } from '@tanstack/react-router';

import { rosterTemplateResponse } from '../../server/roster-template.server';

/** The roster template file for the signed-in user (see `downloadRosterTemplate`). */
export const Route = createFileRoute('/roster/template')({
  server: {
    handlers: {
      GET: ({ request }) => rosterTemplateResponse(request),
    },
  },
});
