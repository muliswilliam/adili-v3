import { useToday } from '@adili/ui';
import {
  getRouteApi,
  useHydrated,
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
  queueLoadKey,
  type QueueSearch,
  readQueueSearch,
  splitQueueSearch,
} from '../../../review-queue/query';
import type { QueueSummary } from '../../../review-queue/rows';
import { getReviewers } from '../../../server/review-case';
import type { Reviewer } from '../../../server/review-case.server';
import { getReviewQueue, type QueuePage as QueueListPage } from '../../../server/review-queue';
import type { ServiceResult } from '../../../server/service-call';
import { type LoadedFor, useReloadingInPlace } from '../../reload-in-place';
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

/** What the list loads for each set of filters (`queueLoadKey`). */
export interface QueueListLoad extends LoadedFor {
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
  // The server has no history state: until hydrated, render as it did, without the text.
  const hydrated = useHydrated();
  const stateText = useLocation({ select: (location) => location.state.reviewQueueSearch });
  const text = hydrated ? stateText : undefined;
  const searchStr = useLocation({ select: (location) => location.searchStr });
  const search = readQueueSearch(useSearch({ strict: false }), text);
  const { viewer, supervisor } = reviewLayout.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  // A reload renders on the server, which has no history state: the list then comes without the
  // search the entry holds, and loads again here for it, as after a change made mid-load.
  const loading = useReloadingInPlace(list, queueLoadKey(searchStr, search));
  const href = useRouterState({ select: (state) => state.location.href });
  const slug = viewer.directory.ok ? viewer.directory.principal.tenant : null;
  const today = useToday();
  const reviewers = useReviewers(supervisor ? slug : null, viewer.user.subject);
  // Only Copy link reads the address, on click, so the server's render needs no origin.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

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
