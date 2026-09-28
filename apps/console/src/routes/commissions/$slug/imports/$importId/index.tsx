import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { pagingFor } from '../../../../../components/paging';
import { reportCsvUrl } from '../../../../../components/roster/import-report';
import {
  ImportReport,
  type ImportReportData,
  importReportCrumb,
  ImportReportSkeleton,
  importReportTitle,
  ImportReportUnavailable,
  loadImportReport,
} from '../../../../../components/roster/import-report-page';
import { messages as m } from '../../../../../components/roster/messages';
import type { RejectedRowsPager } from '../../../../../components/roster/use-rejected-rows';
import { signInRedirect } from '../../../../../components/sign-in-redirect';

/** `rows`: the cursor of the page of rejected rows on show, so reload and links keep it. */
const reportSearch = z.object({ rows: z.string().max(500).optional().catch(undefined) });

/**
 * One import of a Commission, from its page's import history, for platform admins and EACC. The
 * directory shows EACC the import but not its rows (personal data), and the report says so.
 */
export const Route = createFileRoute('/commissions/$slug/imports/$importId/')({
  validateSearch: reportSearch,
  // Not a loader dependency: paging the rejected rows reads only them, not the report again.
  loader: async ({ params, location, context }): Promise<ImportReportData | null> => {
    // The layout shows no Commission without the workspace; do not fetch its import.
    if (!context.workspace) return null;
    const { rows } = reportSearch.parse(location.search);
    return loadImportReport(params.slug, params.importId, rows, () => {
      throw signInRedirect(location.href);
    });
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.imp.ok ? importReportTitle(loaderData.imp.data) : m.reportPageTitle} · Adili Online Console`,
      },
    ],
  }),
  staticData: { crumb: ({ loaderData }) => importReportCrumb(loaderData) },
  pendingComponent: ImportReportSkeleton,
  component: CommissionImportReportPage,
});

function CommissionImportReportPage() {
  const data = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { workspace } = Route.useRouteContext();
  const rowsPager = useRowsPager();
  if (!data) return null;
  const { imp } = data;
  if (!imp.ok) {
    return (
      <ImportReportUnavailable
        imp={imp}
        backLink={
          <Link to="/commissions/$slug" params={{ slug }} hash="roster">
            {m.backToCommission}
          </Link>
        }
      />
    );
  }
  // Platform admins open the records (audited); EACC sees counts only.
  const canOpenRecords = workspace?.readOnly === false;
  return (
    <ImportReport
      key={imp.data.id}
      imp={imp.data}
      slug={slug}
      returnTo={`/commissions/${slug}/imports/${imp.data.id}`}
      initialRows={data.rows}
      rowsPager={rowsPager}
      reportCsvUrl={reportCsvUrl(imp.data.id, slug)}
      reviewFlagged={
        canOpenRecords ? (
          <Link to="/commissions/$slug/records" params={{ slug }} search={{ flagged: true }}>
            {m.reviewFlaggedButton}
          </Link>
        ) : null
      }
    />
  );
}

/** The page of rejected rows on show: its cursor in the URL, the way back in history state. */
function useRowsPager(): RejectedRowsPager {
  const { rows } = Route.useSearch();
  const state = useLocation({ select: (location) => location.state.rejectedRowsPaging });
  const navigate = useNavigate({ from: Route.fullPath });
  return {
    location: { search: { cursor: rows }, state: pagingFor(rows, state) },
    go: ({ search, state: paging }) => {
      void navigate({
        search: (current) => ({ ...current, rows: search.cursor }),
        state: (current) => ({ ...current, rejectedRowsPaging: paging }),
        resetScroll: false,
      });
    },
  };
}
