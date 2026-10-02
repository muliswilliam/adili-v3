import {
  createFileRoute,
  Link,
  useLocation,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';

import { AccessTabs } from '../../../components/access/access-tabs';
import { messages as m } from '../../../components/access/messages';
import { QueueList } from '../../../components/access/queue-list';
import { type QueueSearch, queueSearchSchema } from '../../../components/access/queue-query';
import { ReadOnlyBadge } from '../../../components/commissions/badges';
import { CursorPager } from '../../../components/cursor-pager';
import { Page, PageHead } from '../../../components/page';
import {
  nextPage,
  type PageLocation,
  type PagingState,
  pagingFor,
  pagingView,
  previousPage,
} from '../../../components/paging';
import { signInRedirect } from '../../../components/sign-in-redirect';
import type { AccessResult } from '../../../server/access-requests.server';
import { getAccessQueue } from '../../../server/access-requests';
import type { QueuePage } from '../../../server/access/types';
import { SERVICE_UNAVAILABLE } from '../../../server/service-call';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The way back from a later page of the access requests queue (see `paging.ts`). */
    accessQueuePaging?: PagingState;
  }
}

const PATH = '/access/requests';

export const Route = createFileRoute('/access/requests/')({
  validateSearch: queueSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, location, context }): Promise<AccessResult<QueuePage> | null> => {
    // The layout shows no queue without the workspace; do not fetch one.
    if (!context.workspace) return null;
    // The queue is the viewer's own Commission's, the tenant of their session.
    if (!context.tenant) return SERVICE_UNAVAILABLE;
    const result = await getAccessQueue({ data: { slug: context.tenant, ...deps } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: QueueLoading,
  component: QueueLoaded,
});

function QueueLoading() {
  return <QueuePage result={null} />;
}

function QueueLoaded() {
  const result = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!result) return null;
  return <QueuePage result={result} />;
}

const pagerLabels = {
  pagination: m.pagination,
  pageRange: m.pageRange,
  pageRows: m.pageRows,
  previousPage: m.previousPage,
  nextPage: m.nextPage,
};

/** The queue page (spec 10 FE-5); `result` is null while the first page loads. */
function QueuePage({ result }: { result: AccessResult<QueuePage> | null }) {
  const committed = Route.useSearch();
  const { workspace } = Route.useRouteContext();
  const navigate = useNavigate({ from: `${PATH}/` });
  const pagingState = useLocation({ select: (location) => location.state.accessQueuePaging });
  // Filter changes keep this page mounted (and the search box focused) while the loader runs;
  // the toolbar shows the filters being loaded rather than the previous ones.
  const pending = useRouterState({
    select: (state) =>
      state.status === 'pending' && state.location.pathname === PATH ? state.location.search : null,
  });
  const search = pending ? queueSearchSchema.parse(pending) : committed;
  const readOnly = workspace?.readOnly ?? true;

  const changeSearch = (next: QueueSearch, options?: { replace?: boolean }) => {
    // A new filter starts from the first page.
    void navigate({ search: { ...next, cursor: undefined }, replace: options?.replace });
  };
  const go = ({ search: to, state }: PageLocation<QueueSearch>) => {
    void navigate({ search: to, state: { accessQueuePaging: state } });
  };

  const page = !pending && result?.ok ? result.data : null;
  const paging = pagingFor(committed.cursor, pagingState);
  const view = page ? pagingView(page, paging) : null;
  const next = page ? nextPage(committed, page, paging) : null;

  return (
    <Page>
      <PageHead title={m.title} actions={readOnly ? <ReadOnlyBadge /> : null} />
      <AccessTabs current={search.kind ?? 'all'} />
      <QueueList
        result={pending ? null : result}
        search={search}
        onSearchChange={changeSearch}
        requestLink={(item) =>
          item.kind === 'lea' ? (
            <Link to="/access/lea-requests/$leaRequestId" params={{ leaRequestId: item.id }}>
              {item.reference}
            </Link>
          ) : (
            <Link to="/access/requests/$requestId" params={{ requestId: item.id }}>
              {item.reference}
            </Link>
          )
        }
        pager={
          page && view && page.items.length > 0 ? (
            <CursorPager
              labels={pagerLabels}
              range={view.range}
              rows={page.items.length}
              hasPrevious={view.hasPrevious}
              hasNext={next !== null}
              onPrevious={() => {
                go(previousPage(committed, paging));
              }}
              onNext={() => {
                if (next) go(next);
              }}
            />
          ) : null
        }
      />
    </Page>
  );
}
