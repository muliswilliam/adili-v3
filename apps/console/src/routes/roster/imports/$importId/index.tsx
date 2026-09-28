import { Button, Icon } from '@adili/ui';
import { Upload04Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { type PagingState, pagingFor } from '../../../../components/paging';
import { reportCsvUrl } from '../../../../components/roster/import-report';
import {
  ImportReport,
  type ImportReportData,
  importReportCrumb,
  ImportReportSkeleton,
  importReportTitle,
  ImportReportUnavailable,
  loadImportReport,
} from '../../../../components/roster/import-report-page';
import { messages as m } from '../../../../components/roster/messages';
import type { RejectedRowsPager } from '../../../../components/roster/use-rejected-rows';
import { signInRedirect } from '../../../../components/sign-in-redirect';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The way back from a later page of an import's rejected rows (see `paging.ts`). */
    rejectedRowsPaging?: PagingState;
  }
}

/** `rows`: the cursor of the page of rejected rows on show, so reload and links keep it. */
const reportSearch = z.object({ rows: z.string().max(500).optional().catch(undefined) });

const returnTo = (importId: string) => `/roster/imports/${importId}`;

export const Route = createFileRoute('/roster/imports/$importId/')({
  validateSearch: reportSearch,
  // Not a loader dependency: paging the rejected rows reads only them (in the component), not
  // the report again; the loader reads the page the URL names when the report opens.
  loader: async ({ params, location, context }): Promise<ImportReportData | null> => {
    // The layout shows no report without the workspace; do not fetch one.
    if (!context.workspace) return null;
    if (!context.tenant) {
      return { imp: { ok: false, error: { kind: 'unavailable', detail: null } } };
    }
    const { rows } = reportSearch.parse(location.search);
    return loadImportReport(context.tenant, params.importId, rows, () => {
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
  component: ImportReportPage,
});

/** One import of the viewer's own Commission. */
function ImportReportPage() {
  const data = Route.useLoaderData();
  const { tenant, workspace } = Route.useRouteContext();
  const rowsPager = useRowsPager();
  if (!data) return null;
  const { imp } = data;
  if (!imp.ok || !tenant) {
    return (
      <ImportReportUnavailable
        imp={imp}
        backLink={<Link to="/roster/imports">{m.backToHistory}</Link>}
      />
    );
  }
  return (
    <ImportReport
      key={imp.data.id}
      imp={imp.data}
      slug={tenant}
      returnTo={returnTo(imp.data.id)}
      initialRows={data.rows}
      rowsPager={rowsPager}
      reportCsvUrl={reportCsvUrl(imp.data.id)}
      reviewFlagged={<Link to="/roster/flagged">{m.reviewFlaggedButton}</Link>}
      actions={(current) =>
        // An HR system resends its batch itself; only a file is corrected here.
        current.state === 'failed' &&
        current.channel === 'file' &&
        workspace &&
        !workspace.readOnly ? (
          <Button asChild>
            <Link to="/roster/import">
              <Icon icon={Upload04Icon} />
              {m.importCorrected}
            </Link>
          </Button>
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
