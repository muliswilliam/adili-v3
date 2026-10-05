import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { ApprovalsView } from '../../components/approvals/approvals-view';
import { messages as t } from '../../components/approvals/messages';
import {
  nextPage,
  type PageLocation,
  type PagingState,
  pagingFor,
  pagingView,
  previousPage,
} from '../../components/paging';
import { signInRedirect } from '../../components/sign-in-redirect';
import { DEFAULT_INBOX_KIND, INBOX_KINDS } from '../../approvals/kinds';
import { getApprovals } from '../../server/approvals';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The approvals inbox's way back through its pages (`components/paging.ts`). */
    approvalsPaging?: PagingState;
  }
}

const searchSchema = z.object({
  /** The tab; the first kind when absent or unknown. */
  kind: z.enum(INBOX_KINDS).default(DEFAULT_INBOX_KIND).catch(DEFAULT_INBOX_KIND),
  cursor: z.string().max(500).optional(),
});
type ApprovalsSearch = z.infer<typeof searchSchema>;

/**
 * The approvals inbox (spec 08 FE-3, S14): one kind a tab, its page in the URL (`kind`,
 * `cursor`), the way back in history state.
 */
export const Route = createFileRoute('/approvals/')({
  staticData: { hideBreadcrumbs: true },
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ kind: search.kind, cursor: search.cursor }),
  loader: async ({ context, deps, location }) => {
    if (!context.workspace) return null;
    const slug = context.viewer.directory.ok ? context.viewer.directory.principal.tenant : null;
    if (!slug) return { ...SERVICE_UNAVAILABLE, now: new Date().toISOString(), slug: '' };
    const load = await getApprovals({ data: { slug, kind: deps.kind, cursor: deps.cursor } });
    if (!load.ok && load.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { ...load, slug };
  },
  head: () => ({ meta: [{ title: `${t.title} · Adili Online Console` }] }),
  pendingComponent: ApprovalsLoading,
  component: ApprovalsRoute,
});

function ApprovalsLoading() {
  const { viewer } = Route.useRouteContext();
  const { kind } = Route.useSearch();
  return (
    <ApprovalsView
      kind={kind}
      load={null}
      viewer={{ subject: viewer.user.subject, name: viewer.user.name }}
      slug=""
      paging={null}
    />
  );
}

function ApprovalsRoute() {
  const load = Route.useLoaderData();
  const search = Route.useSearch();
  const { viewer } = Route.useRouteContext();
  const navigate = useNavigate({ from: '/approvals/' });
  const state = useLocation({ select: (location) => location.state.approvalsPaging });
  if (!load) return null;
  const { kind } = search;
  const paging = pagingFor(search.cursor, state);
  const go = ({ search: to, state: next }: PageLocation<ApprovalsSearch>) => {
    void navigate({ search: to, state: { approvalsPaging: next } });
  };
  const page = load.ok ? load.data : null;
  const view = page ? pagingView(page, paging) : null;
  const next = page ? nextPage(search, page, paging) : null;
  return (
    <ApprovalsView
      kind={kind}
      load={load}
      viewer={{ subject: viewer.user.subject, name: viewer.user.name }}
      slug={load.slug}
      paging={
        view
          ? {
              range: view.range,
              hasPrevious: view.hasPrevious,
              onPrevious: () => {
                go(previousPage(search, paging));
              },
              onNext: next
                ? () => {
                    go(next);
                  }
                : null,
            }
          : null
      }
    />
  );
}
