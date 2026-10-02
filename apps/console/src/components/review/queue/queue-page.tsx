import { useToday } from '@adili/ui';
import {
  getRouteApi,
  useLocation,
  useNavigate,
  useRouter,
  useRouterState,
  useSearch,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import {
  cycleOptions,
  QUEUE_PAGE_SIZE,
  type QueueSearch,
  readQueueSearch,
  splitQueueSearch,
} from '../../../review-queue/query';
import type { QueueSummary } from '../../../review-queue/rows';
import { getReviewers } from '../../../server/review-case';
import type { Reviewer } from '../../../server/review-case.server';
import { getReviewQueue, type QueuePage as QueueListPage } from '../../../server/review-queue';
import type { ServiceResult } from '../../../server/service-call';
import { useReloadingInPlace } from '../../reload-in-place';
import { QueueView } from './queue-view';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The queue's search text: personal data, so in the history entry, not the URL. */
    reviewQueueSearch?: string;
  }
}

/** What the queue's layout loads once per visit: the tiles' counts and the heading. */
export interface QueueSummaryLoad {
  summary: ServiceResult<QueueSummary>;
  /** The Commission's name for the heading; null when it could not be read. */
  commission: string | null;
}

/** What the list loads for each set of filters. */
export interface QueueListLoad {
  /** The search text the list was loaded for. */
  text: string | null;
  list: ServiceResult<QueueListPage>;
}

const reviewLayout = getRouteApi('/review');

/**
 * The review queue page (spec 07a FE-2): the filters from the URL (S19) and the search text from
 * the history entry (no PII in URLs). `queue` is null while the counts load, `list` while the
 * first page does; the queue's layout shows the page with neither while it loads.
 */
export function QueuePage({
  queue,
  list,
}: {
  queue: QueueSummaryLoad | null;
  list: QueueListLoad | null;
}) {
  const text = useLocation({ select: (location) => location.state.reviewQueueSearch });
  const search = readQueueSearch(useSearch({ strict: false }), text);
  const { viewer, supervisor } = reviewLayout.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  const loading = useReloadingInPlace();
  const href = useRouterState({ select: (state) => state.location.href });
  const slug = viewer.directory.ok ? viewer.directory.principal.tenant : null;
  const today = useToday();
  const reviewers = useReviewers(supervisor ? slug : null, viewer.user.subject);
  // Only Copy link reads the address, on click, so the server's render needs no origin.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // A reload renders on the server, which has no history state: the list then comes without the
  // search the entry still holds, so load it again here for that search.
  const idle = useRouterState({ select: (state) => state.status === 'idle' });
  const stale = list !== null && idle && list.text !== (search.search ?? null);
  useEffect(() => {
    if (stale) void router.invalidate();
  }, [stale, router]);

  return (
    <QueueView
      commission={queue?.commission ?? null}
      summary={queue?.summary ?? null}
      list={loading ? null : (list?.list ?? null)}
      search={search}
      onSearchChange={(next: QueueSearch, options?: { replace?: boolean }) => {
        const { url, text: nextText } = splitQueueSearch(next);
        void navigate({
          to: '/review',
          search: url,
          state: (state) => ({ ...state, reviewQueueSearch: nextText }),
          replace: options?.replace,
        });
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
