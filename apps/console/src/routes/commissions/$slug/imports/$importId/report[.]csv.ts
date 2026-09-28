import { createFileRoute } from '@tanstack/react-router';

import { rosterImportReportResponse } from '../../../../../server/roster-import-report.server';

/** A Commission's import's rejected rows as CSV, for platform admins on its page. */
export const Route = createFileRoute('/commissions/$slug/imports/$importId/report.csv')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        rosterImportReportResponse(request, { importId: params.importId, slug: params.slug }),
    },
  },
});
