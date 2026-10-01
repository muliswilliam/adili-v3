import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { HISTORY_FILTERS } from '../../access/history';
import { HISTORY_COPY as COPY } from '../../access/history-copy';
import { HistoryUnavailable, HistoryView } from '../../components/access-history/history-view';
import { TransparencyFrame } from '../../components/access-history/transparency-frame';
import { TransparencySkeleton } from '../../components/access-history/transparency-skeleton';
import { signInRedirect } from '../../components/declaration/route-helpers';
import { getMyAccessHistory } from '../../server/access-history';

/**
 * Who accessed my declaration (spec 10 FE-4, S12): every request, decision, download and
 * certified copy about the declarant's declaration, as they may see it (`?filter=lea&page=2`).
 */
export const Route = createFileRoute('/access/history')({
  validateSearch: z.object({
    filter: z.enum(HISTORY_FILTERS).optional().catch(undefined),
    page: z.coerce.number().int().min(1).optional().catch(undefined),
  }),
  loader: async ({ location }) => {
    const result = await getMyAccessHistory();
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: 'Who accessed my declaration · Adili Online' }] }),
  pendingComponent: () => (
    <TransparencyFrame title={COPY.title} active="/access/history">
      <TransparencySkeleton />
    </TransparencyFrame>
  ),
  component: HistoryRoute,
});

function HistoryRoute() {
  const { history, notices, now } = Route.useLoaderData();
  const { filter, page } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <TransparencyFrame title={COPY.title} active="/access/history">
      {history.status === 'ok' ? (
        <HistoryView
          entries={history.entries}
          notices={notices.status === 'ok' ? notices.notices : []}
          now={now}
          filter={filter ?? 'all'}
          page={page ?? 1}
          onFilter={(next) => {
            void navigate({ search: { filter: next === 'all' ? undefined : next } });
          }}
          onPage={(next) => {
            void navigate({
              search: (search) => ({ ...search, page: next === 1 ? undefined : next }),
            });
            window.scrollTo(0, 0);
          }}
        />
      ) : (
        <HistoryUnavailable />
      )}
    </TransparencyFrame>
  );
}
