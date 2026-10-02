import { useToday } from '@adili/ui';
import { createFileRoute, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useReloadingInPlace } from '../../components/reload-in-place';
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
import { getCommission } from '../../server/commissions';
import { getReviewers } from '../../server/review-case';
import type { Reviewer } from '../../server/review-case.server';
import { getReviewQueue, getReviewQueueSummary, type QueuePage } from '../../server/review-queue';
import { SERVICE_UNAVAILABLE, type ServiceResult } from '../../server/service-call';

const PATH = '/review';

interface QueueLoad {
  list: ServiceResult<QueuePage>;
  summary: ServiceResult<QueueSummary>;
  /** The Commission's name for the heading; null when it could not be read. */
  commission: string | null;
}

/** The review queue (spec 07a FE-2): the Commission's cases, filters in the URL (S19). */
export const Route = createFileRoute('/review/')({
  validateSearch: queueSearchSchema,
  // Filter changes reload this match in place, not as a new one: see `useReloadingInPlace`.
  shouldReload: true,
  loader: async ({ context, location }): Promise<QueueLoad | null> => {
    // The layout shows why there is no workspace; do not fetch one.
    if (!context.workspace) return null;
    const slug = context.viewer.directory.ok ? context.viewer.directory.principal.tenant : null;
    if (!slug) return { list: SERVICE_UNAVAILABLE, summary: SERVICE_UNAVAILABLE, commission: null };
    const filters = queueSearchSchema.parse(location.search);
    const [list, summary, commission] = await Promise.all([
      getReviewQueue({ data: { slug, filters, limit: QUEUE_PAGE_SIZE } }),
      getReviewQueueSummary({ data: { slug } }),
      getCommission({ data: { slug } }).catch(() => null),
    ]);
    if (
      (!list.ok && list.error.kind === 'unauthenticated') ||
      (!summary.ok && summary.error.kind === 'unauthenticated')
    ) {
      throw signInRedirect(location.href);
    }
    return { list, summary, commission: commission?.ok ? commission.data.name : null };
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
  const search = Route.useSearch();
  const { viewer, supervisor } = Route.useRouteContext();
  const navigate = useNavigate({ from: `${PATH}/` });
  const router = useRouter();
  const loading = useReloadingInPlace();
  const href = useRouterState({ select: (state) => state.location.href });
  const slug = viewer.directory.ok ? viewer.directory.principal.tenant : null;
  const today = useToday();
  const reviewers = useReviewers(supervisor ? slug : null, viewer.user.subject);
  // Only Copy link reads the address, on click, so the server's render needs no origin.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <QueueView
      commission={load?.commission ?? null}
      summary={load?.summary ?? null}
      list={loading ? null : (load?.list ?? null)}
      search={search}
      onSearchChange={(next: QueueSearch, options?: { replace?: boolean }) => {
        void navigate({ search: next, replace: options?.replace });
      }}
      viewer={{ subject: viewer.user.subject, name: viewer.user.name, supervisor }}
      slug={slug}
      cycles={cycleOptions(today, search.cycle)}
      reviewers={reviewers}
      href={`${origin}${href}`}
      loadPage={(cursor) =>
        getReviewQueue({
          data: { slug: slug ?? '', filters: search, cursor, limit: QUEUE_PAGE_SIZE },
        })
      }
      refresh={() => router.invalidate()}
    />
  );
}

/**
 * The reviewers a supervisor can filter by: the Commission's reviewers and supervisors (as the
 * reassign dialog lists them), the supervisor aside (that is Mine). Null for reviewers, while
 * they load, or when they could not be loaded (the filter then offers Mine and Unassigned).
 */
function useReviewers(slug: string | null, self: string): Reviewer[] | null {
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    void getReviewers({ data: { slug, assignee: null, reviewerHistory: [] } })
      .then((result) => {
        if (live && result.ok) {
          setReviewers(result.data.filter((reviewer) => reviewer.subject !== self));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slug, self]);
  return reviewers;
}
