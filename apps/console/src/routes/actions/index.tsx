import { createFileRoute, useLocation, useNavigate, useRouterState } from '@tanstack/react-router';
import { z } from 'zod';

import { filterQuery, LADDER_FILTERS, type LadderFilter } from '../../actions/ladder';
import { ActionsList } from '../../components/actions/actions-list';
import { en as m } from '../../components/actions/messages';
import { CursorPager } from '../../components/cursor-pager';
import { Page, PageHead } from '../../components/page';
import {
  nextPage,
  type PageLocation,
  type PagingState,
  pagingFor,
  pagingView,
  previousPage,
} from '../../components/paging';
import { signInRedirect } from '../../components/sign-in-redirect';
import { getLadders, type LadderPage } from '../../server/actions';
import { SERVICE_UNAVAILABLE, type ServiceResult } from '../../server/service-call';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The way back from a later page of the Actions list (see `paging.ts`). */
    actionsPaging?: PagingState;
  }
}

/** Ladders per page. */
const PAGE_SIZE = 20;

const searchSchema = z.object({
  filter: z.enum(LADDER_FILTERS).exclude(['all']).optional().catch(undefined),
  cursor: z.string().max(500).optional().catch(undefined),
});
type ActionsSearch = z.infer<typeof searchSchema>;

interface ActionsLoad {
  result: ServiceResult<LadderPage>;
  now: string;
}

/** The Commission's administrative action ladders (spec 08 FE-5), filtered and paged in the URL. */
export const Route = createFileRoute('/actions/')({
  staticData: { hideBreadcrumbs: true },
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context, location }): Promise<ActionsLoad | null> => {
    // The layout shows why there is no workspace; do not fetch the list.
    if (!context.workspace) return null;
    const now = new Date().toISOString();
    if (!context.slug) return { result: SERVICE_UNAVAILABLE, now };
    const result = await getLadders({
      data: {
        slug: context.slug,
        ...filterQuery(deps.filter ?? 'all'),
        ...(deps.cursor ? { cursor: deps.cursor } : {}),
        limit: PAGE_SIZE,
      },
    });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { result, now };
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: () => <ActionsPage load={null} />,
  component: ActionsLoaded,
});

function ActionsLoaded() {
  const load = Route.useLoaderData();
  if (!load) return null;
  return <ActionsPage load={load} />;
}

const pagerLabels = {
  pagination: m.pagination,
  pageRange: m.pageRange,
  pageRows: m.pageRows,
  previousPage: m.previousPage,
  nextPage: m.nextPage,
};

function ActionsPage({ load }: { load: ActionsLoad | null }) {
  const committed = Route.useSearch();
  const navigate = useNavigate({ from: '/actions/' });
  const pagingState = useLocation({ select: (location) => location.state.actionsPaging });
  // A filter change keeps the page mounted while the loader runs, showing the filter being loaded.
  const pending = useRouterState({
    select: (state) =>
      state.status === 'pending' && state.location.pathname === '/actions'
        ? state.location.search
        : null,
  });
  const search: ActionsSearch = pending ? searchSchema.parse(pending) : committed;
  const result = pending ? null : (load?.result ?? null);
  const page = result?.ok ? result.data : null;
  const paging = pagingFor(committed.cursor, pagingState);
  const view = page ? pagingView(page, paging) : null;
  const next = page ? nextPage(committed, page, paging) : null;
  const go = ({ search: to, state }: PageLocation<ActionsSearch>) => {
    void navigate({ search: to, state: { actionsPaging: state } });
  };

  return (
    <Page>
      <PageHead title={m.title} />
      <ActionsList
        result={result}
        filter={search.filter ?? 'all'}
        onFilter={(filter: LadderFilter) => {
          void navigate({ search: { filter: filter === 'all' ? undefined : filter } });
        }}
        now={load?.now ?? new Date().toISOString()}
        pager={
          page && view && page.items.length > 0 && (view.hasPrevious || next) ? (
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
      <p className="mt-3 text-[13.5px] text-muted-foreground">{m.windows}</p>
    </Page>
  );
}
