import { Button, Icon } from '@adili/ui';
import { Add01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AccessTabs } from '../../../components/access/access-tabs';
import { ApplicationsList } from '../../../components/access/self-access/applications-list';
import { messages as m } from '../../../components/access/self-access/messages';
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
import { getSelfAccessApplications } from '../../../server/self-access';
import type { SelfAccessPage, SelfAccessResult } from '../../../server/self-access.server';
import { SERVICE_UNAVAILABLE } from '../../../server/service-call';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The way back from a later page of the certified copies list (see `paging.ts`). */
    selfAccessPaging?: PagingState;
  }
}

const searchSchema = z.object({ cursor: z.string().max(500).optional().catch(undefined) });
type ListSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute('/access/certified-copies/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, location, context }): Promise<SelfAccessResult<SelfAccessPage> | null> => {
    // The layout shows no list without the workspace; do not fetch one.
    if (!context.workspace) return null;
    // The applications are the viewer's own Commission's, the tenant of their session.
    if (!context.tenant) return SERVICE_UNAVAILABLE;
    const result = await getSelfAccessApplications({
      data: { slug: context.tenant, cursor: deps.cursor },
    });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: () => <ListPage result={null} />,
  component: ListLoaded,
});

function ListLoaded() {
  const result = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!result) return null;
  return <ListPage result={result} />;
}

const pagerLabels = {
  pagination: m.pagination,
  pageRange: m.pageRange,
  pageRows: m.pageRows,
  previousPage: m.previousPage,
  nextPage: m.nextPage,
};

/** The Certified copies tab (spec 10 slice #302); `result` is null while the page loads. */
function ListPage({ result }: { result: SelfAccessResult<SelfAccessPage> | null }) {
  const search = Route.useSearch();
  const { workspace } = Route.useRouteContext();
  const navigate = useNavigate({ from: '/access/certified-copies/' });
  const pagingState = useLocation({ select: (location) => location.state.selfAccessPaging });
  const readOnly = workspace?.readOnly ?? true;

  const go = ({ search: to, state }: PageLocation<ListSearch>) => {
    void navigate({ search: to, state: { selfAccessPaging: state } });
  };
  const page = result?.ok ? result.data : null;
  const paging = pagingFor(search.cursor, pagingState);
  const view = page ? pagingView(page, paging) : null;
  const next = page ? nextPage(search, page, paging) : null;

  return (
    <Page>
      <PageHead
        title={m.workspaceTitle}
        actions={
          readOnly ? (
            <ReadOnlyBadge />
          ) : (
            <Button asChild size="sm">
              <Link to="/access/certified-copies/new">
                <Icon icon={Add01Icon} />
                {m.recordApplication}
              </Link>
            </Button>
          )
        }
      />
      <AccessTabs current="certified-copies" />
      <ApplicationsList
        result={result}
        readOnly={readOnly}
        applicationLink={(application) => (
          <Link
            to="/access/certified-copies/$applicationId"
            params={{ applicationId: application.id }}
          >
            {application.declarant.fullName}
          </Link>
        )}
        pager={
          page && view && page.items.length > 0 && (view.hasPrevious || next !== null) ? (
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
          ) : null
        }
      />
    </Page>
  );
}
