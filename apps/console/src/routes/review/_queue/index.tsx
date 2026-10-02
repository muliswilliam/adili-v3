import { createFileRoute, getRouteApi } from '@tanstack/react-router';

import { type QueueListLoad, QueuePage } from '../../../components/review/queue/queue-page';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { QUEUE_COPY as m } from '../../../review-queue/messages';
import {
  QUEUE_PAGE_SIZE,
  queueLoadKey,
  queueUrlSchema,
  readQueueSearch,
} from '../../../review-queue/query';
import { getReviewQueue } from '../../../server/review-queue';
import { SERVICE_UNAVAILABLE } from '../../../server/service-call';

const queueLayout = getRouteApi('/review/_queue');

/**
 * The review queue's list (spec 07a FE-2): the Commission's cases for the filters in the URL
 * (S19) and the search text in the history entry's state (no PII in URLs). The counts and the
 * heading are the layout's, so a filter change reloads the list alone.
 */
export const Route = createFileRoute('/review/_queue/')({
  validateSearch: queueUrlSchema,
  // Filter changes reload this match in place, not as a new one: see `useReloadingInPlace`.
  shouldReload: true,
  loader: async ({ context, location }): Promise<QueueListLoad | null> => {
    // The layout shows why there is no workspace; do not fetch one.
    if (!context.workspace) return null;
    const slug = context.viewer.directory.ok ? context.viewer.directory.principal.tenant : null;
    const filters = readQueueSearch(location.search, location.state.reviewQueueSearch);
    const loadedFor = queueLoadKey(location.searchStr, filters);
    if (!slug) return { loadedFor, list: SERVICE_UNAVAILABLE };
    const list = await getReviewQueue({ data: { slug, filters, limit: QUEUE_PAGE_SIZE } });
    if (!list.ok && list.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { loadedFor, list };
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: QueueListLoading,
  component: QueueLoaded,
});

function QueueListLoading() {
  return <QueuePage queue={queueLayout.useLoaderData()} list={null} />;
}

function QueueLoaded() {
  const queue = queueLayout.useLoaderData();
  const list = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!queue || !list) return null;
  return <QueuePage queue={queue} list={list} />;
}
