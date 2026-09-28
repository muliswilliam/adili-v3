import { createFileRoute } from '@tanstack/react-router';

import { rosterImportReportResponse } from '../../../../server/roster-import-report.server';

/** An import's rejected rows as CSV for the signed-in user (see `useReportDownload`). */
export const Route = createFileRoute('/roster/imports/$importId/report.csv')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        rosterImportReportResponse(request, { importId: params.importId }),
    },
  },
});
