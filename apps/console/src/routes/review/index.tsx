import { useToday } from '@adili/ui';
import { createFileRoute, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { QueueView } from '../../components/review/queue/queue-view';
import { signInRedirect } from '../../components/sign-in-redirect';
import { QUEUE_COPY as m } from '../../review-queue/messages';
import {
  cycleOptions,
  QUEUE_PAGE_SIZE,
  type QueueSearch,
  queueSearchSchema,
} from '../../review-queue/query';
import type { QueueSummary } from '../../review-queue/rows';
import { getReassignOfficers } from '../../server/review-case';
import type { Officer } from '../../server/review-case.server';
import { getReviewQueue, getReviewQueueSummary, type QueuePage } from '../../server/review-queue';
import { SERVICE_UNAVAILABLE, type ServiceResult } from '../../server/service-call';

const PATH = '/review';

interface QueueLoad {
  list: ServiceResult<QueuePage>;
  summary: ServiceResult<QueueSummary>;
}

/** The review queue (spec 07a FE-2): the Commission's cases, filters in the URL (S19). */
export const Route = createFileRoute('/review/')({
  validateSearch: queueSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context, location }): Promise<QueueLoad | null> => {
    // The layout shows why there is no workspace; do not fetch one.
    if (!context.workspace) return null;
    const slug = context.viewer.directory.ok ? context.viewer.directory.principal.tenant : null;
    if (!slug) return { list: SERVICE_UNAVAILABLE, summary: SERVICE_UNAVAILABLE };
    const [list, summary] = await Promise.all([
      getReviewQueue({ data: { slug, filters: deps, limit: QUEUE_PAGE_SIZE } }),
      getReviewQueueSummary({ data: { slug } }),
    ]);
    if (
      (!list.ok && list.error.kind === 'unauthenticated') ||
      (!summary.ok && summary.error.kind === 'unauthenticated')
    ) {
      throw signInRedirect(location.href);
    }
    return { list, summary };
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: QueueLoading,
  component: QueueLoaded,
});

function QueueLoading() {
  return <QueuePageView load={null} />;
}

function QueueLoaded() {
  const load = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!load) return null;
  return <QueuePageView load={load} />;
}

/** The workspace page; `load` is null while the first page loads. */
function QueuePageView({ load }: { load: QueueLoad | null }) {
  const committed = Route.useSearch();
  const { viewer, supervisor } = Route.useRouteContext();
  const navigate = useNavigate({ from: `${PATH}/` });
  const router = useRouter();
  // Filter changes keep this page mounted (and the search box focused) while the loader runs;
  // the toolbar shows the filters being loaded rather than the previous ones.
  const pending = useRouterState({
    select: (state) =>
      state.status === 'pending' && state.location.pathname === PATH ? state.location.search : null,
  });
  const href = useRouterState({ select: (state) => state.location.href });
  const search = pending ? queueSearchSchema.parse(pending) : committed;
  const slug = viewer.directory.ok ? viewer.directory.principal.tenant : null;
  const today = useToday();
  const officers = useOfficers(supervisor ? slug : null, viewer.user.subject);
  // Only Copy link reads the address, on click, so the server's render needs no origin.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <QueueView
      summary={load?.summary ?? null}
      list={pending ? null : (load?.list ?? null)}
      search={search}
      onSearchChange={(next: QueueSearch, options?: { replace?: boolean }) => {
        void navigate({ search: next, replace: options?.replace });
      }}
      viewer={{ subject: viewer.user.subject, name: viewer.user.name, supervisor }}
      slug={slug}
      cycles={cycleOptions(today, search.cycle)}
      officers={officers}
      href={`${origin}${href}`}
      loadPage={(cursor) =>
        getReviewQueue({
          data: { slug: slug ?? '', filters: committed, cursor, limit: QUEUE_PAGE_SIZE },
        })
      }
      refresh={() => router.invalidate()}
    />
  );
}

/**
 * The officers a supervisor can filter by: those who hold review cases in the Commission (as the
 * reassign dialog lists them), the supervisor aside (that is Mine). Null for reviewers, while
 * they load, or when they could not be loaded (the filter then offers Mine and Unassigned).
 */
function useOfficers(slug: string | null, self: string): Officer[] | null {
  const [officers, setOfficers] = useState<Officer[] | null>(null);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    void getReassignOfficers({ data: { slug, assignee: null, reviewerHistory: [] } })
      .then((result) => {
        if (live && result.ok) {
          setOfficers(result.data.filter((officer) => officer.subject !== self));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slug, self]);
  return officers;
}
