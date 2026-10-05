import { Button, Card, EmptyState, Icon } from '@adili/ui';
import { Clock01Icon, Upload04Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { CursorPager } from '../../../components/cursor-pager';
import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { type LoadedFor, useReloadingInPlace } from '../../../components/reload-in-place';
import {
  nextPage,
  type PageLocation,
  type PagingState,
  pagingFor,
  pagingView,
  previousPage,
} from '../../../components/paging';
import {
  ImportHistoryResults,
  ImportHistorySkeleton,
} from '../../../components/roster/import-history-table';
import { messages as m } from '../../../components/roster/messages';
import { signInRedirect } from '../../../components/sign-in-redirect';
import type { DirectoryResult, RosterImportPage } from '../../../server/directory/client';
import { listRosterImports } from '../../../server/roster-imports';
import { SERVICE_UNAVAILABLE } from '../../../server/service-call';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The way back from a later page of the import history (see `paging.ts`). */
    rosterImportsPaging?: PagingState;
  }
}

const historySearch = z.object({ cursor: z.string().max(500).optional().catch(undefined) });
type HistorySearch = z.infer<typeof historySearch>;

export const Route = createFileRoute('/roster/imports/')({
  validateSearch: historySearch,
  // A page change reloads this match in place, not as a new one: see `useReloadingInPlace`.
  shouldReload: true,
  loader: async ({ location, context }) => {
    // The layout shows no history without the workspace; do not fetch one.
    if (!context.workspace) return null;
    if (!context.tenant) return { result: SERVICE_UNAVAILABLE, loadedFor: location.searchStr };
    const result = await listRosterImports({
      data: { slug: context.tenant, cursor: historySearch.parse(location.search).cursor },
    });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { result, loadedFor: location.searchStr };
  },
  head: () => ({ meta: [{ title: `${m.historyTitle} · Adili Online Console` }] }),
  pendingComponent: HistoryLoading,
  component: HistoryLoaded,
});

function HistoryLoading() {
  return <HistoryPage loaded={null} />;
}

function HistoryLoaded() {
  const loaded = Route.useLoaderData();
  if (!loaded) return null;
  return <HistoryPage loaded={loaded} />;
}

/** The way into the import wizard, for the reporting officer. */
function ImportButton({ size }: { size?: 'sm' }) {
  return (
    <Button asChild size={size}>
      <Link to="/roster/import">
        <Icon icon={Upload04Icon} />
        {m.importRoster}
      </Link>
    </Button>
  );
}

/** Import history (spec 02): every import of the Commission, newest first; `null` while loading. */
function HistoryPage({
  loaded,
}: {
  loaded: (LoadedFor & { result: DirectoryResult<RosterImportPage> }) | null;
}) {
  const result = loaded?.result ?? null;
  const { workspace } = Route.useRouteContext();
  // A page change keeps the page, Import button and all; only the list shows it is loading.
  const reloading = useReloadingInPlace(loaded);
  if (!workspace) return null;
  const readOnly = workspace.readOnly;
  const empty = result?.ok === true && result.data.items.length === 0 && !result.data.nextCursor;
  return (
    <Page>
      <PageHead
        title={m.historyTitle}
        actions={readOnly || !result?.ok || empty ? null : <ImportButton />}
      />
      {result === null || reloading ? (
        <Card className="overflow-hidden p-0 sm:p-0">
          <ImportHistorySkeleton />
        </Card>
      ) : !result.ok ? (
        <LoadError
          title={m.historyErrorTitle}
          detail={
            (result.error.kind === 'unavailable' ? result.error.detail : null) ??
            (result.error.kind === 'problem' ? result.error.problem.detail : undefined) ??
            m.errorDetail
          }
          retryLabel={m.tryAgain}
        />
      ) : empty ? (
        <Card className="p-2 sm:p-2">
          <EmptyState
            icon={<Icon icon={Clock01Icon} />}
            title={m.historyEmptyTitle}
            description={readOnly ? m.historyEmptyTextReadOnly : m.historyEmptyText}
            action={readOnly ? undefined : <ImportButton size="sm" />}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 sm:p-0">
          <History page={result.data} />
        </Card>
      )}
    </Page>
  );
}

const pagerLabels = {
  pagination: m.historyPagination,
  pageRange: m.historyPageRange,
  pageRows: m.historyPageRows,
  previousPage: m.previousPage,
  nextPage: m.nextPage,
};

function History({ page }: { page: RosterImportPage }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/roster/imports/' });
  const pagingState = useLocation({ select: (location) => location.state.rosterImportsPaging });
  const paging = pagingFor(search.cursor, pagingState);
  const view = pagingView(page, paging);
  const next = nextPage(search, page, paging);
  const go = ({ search: to, state }: PageLocation<HistorySearch>) => {
    void navigate({ search: to, state: { rosterImportsPaging: state } });
  };
  return (
    <>
      <ImportHistoryResults items={page.items} />
      <CursorPager
        labels={pagerLabels}
        range={view.range}
        rows={page.items.length}
        hasPrevious={view.hasPrevious}
        hasNext={next !== null}
        onPrevious={() => {
          go(previousPage(search, paging));
        }}
        onNext={() => {
          if (next) go(next);
        }}
      />
    </>
  );
}
