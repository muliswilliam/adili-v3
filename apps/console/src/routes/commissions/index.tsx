import { createFileRoute, useLocation, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { CommissionsList } from '../../components/commissions/commissions-list';
import { type PagingState, pagingFor } from '../../components/commissions/paging';
import { loginHref } from '../../components/login-redirect';
import {
  type CommissionFilters,
  commissionListSearchSchema,
  searchForFilters,
} from '../../lib/commission-filters';
import { listCommissions } from '../../server/commissions';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The way back from a later page of the Commissions list (see `paging.ts`). */
    commissionsPaging?: PagingState;
  }
}

export const Route = createFileRoute('/commissions/')({
  validateSearch: commissionListSearchSchema,
  loaderDeps: ({ search }) => search,
  // Not awaited: the navigation completes at once and the page streams in behind skeleton rows,
  // so the toolbar stays mounted (and keeps focus) while a filter change loads.
  loader: ({ deps, context }) => ({
    page: context.access ? listCommissions({ data: deps }) : null,
  }),
  component: CommissionsListRoute,
});

function CommissionsListRoute() {
  const { page } = Route.useLoaderData();
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const pagingState = useLocation({ select: (location) => location.state.commissionsPaging });
  const navigate = Route.useNavigate();
  const router = useRouter();

  const onFiltersChange = useCallback(
    (filters: CommissionFilters) => {
      void navigate({ search: searchForFilters(filters), replace: true });
    },
    [navigate],
  );
  const onSignedOut = useCallback(() => {
    window.location.assign(loginHref(window.location.href));
  }, []);

  // Users without the workspace get "No staff roles" from the layout.
  if (!access || !page) return null;

  return (
    <CommissionsList
      access={access}
      search={search}
      paging={pagingFor(search.cursor, pagingState)}
      page={page}
      onFiltersChange={onFiltersChange}
      onPageChange={({ search: next, state }) => {
        void navigate({ search: next, state: { commissionsPaging: state } });
      }}
      onRetry={() => {
        void router.invalidate();
      }}
      onSignedOut={onSignedOut}
    />
  );
}
