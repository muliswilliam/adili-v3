import { createFileRoute, Outlet } from '@tanstack/react-router';

import { QueuePage, type QueueSummaryLoad } from '../../components/review/queue/queue-page';
import { signInRedirect } from '../../components/sign-in-redirect';
import { getCommission } from '../../server/commissions';
import { getReviewQueueSummary } from '../../server/review-queue';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';

/**
 * The queue's counts and heading, loaded once per visit to the queue: a filter change reloads the
 * list alone (`./_queue/index.tsx`), while a claim or reassignment (`router.invalidate()`) and the
 * next visit load these again.
 */
export const Route = createFileRoute('/review/_queue')({
  // Never stale while the queue is open, so filter changes leave these be; dropped on leaving it.
  staleTime: Infinity,
  gcTime: 0,
  loader: async ({ context, location }): Promise<QueueSummaryLoad | null> => {
    // The layout shows why there is no workspace; do not fetch one.
    if (!context.workspace) return null;
    const slug = context.viewer.directory.ok ? context.viewer.directory.principal.tenant : null;
    if (!slug) return { summary: SERVICE_UNAVAILABLE, commission: null };
    const [summary, commission] = await Promise.all([
      getReviewQueueSummary({ data: { slug } }),
      getCommission({ data: { slug } }).catch(() => null),
    ]);
    if (!summary.ok && summary.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return { summary, commission: commission?.ok ? commission.data.name : null };
  },
  pendingComponent: QueueLoading,
  component: Outlet,
});

function QueueLoading() {
  return <QueuePage queue={null} list={null} />;
}
