import { Button, Icon } from '@adili/ui';
import { UserGroupIcon } from '@hugeicons/core-free-icons';
import {
  createFileRoute,
  getRouteApi,
  Link,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';

import { messages as m } from '../../../../components/obligations/messages';
import {
  OBLIGATIONS_PAGE_SIZE,
  type ObligationsSearch,
  obligationsSearchSchema,
} from '../../../../components/obligations/obligations-query';
import { ObligationsView } from '../../../../components/obligations/obligations-view';
import { signInRedirect } from '../../../../components/sign-in-redirect';
import type { DeclarationsResult, ObligationPage } from '../../../../server/declarations/client';
import { getObligation, listCommissionObligations } from '../../../../server/obligations';

export const Route = createFileRoute('/commissions/$slug/obligations/')({
  validateSearch: obligationsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, params, location, context }) => {
    // The layout shows no Commission without the workspace; do not fetch its obligations.
    if (!context.workspace) return null;
    const list = await listCommissionObligations({
      data: { slug: params.slug, ...deps, limit: OBLIGATIONS_PAGE_SIZE },
    });
    if (!list.ok && list.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return list;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: ObligationsLoading,
  component: ObligationsLoaded,
});

const layout = getRouteApi('/commissions/$slug/obligations');

function ObligationsLoading() {
  return <CommissionObligationsPage list={null} />;
}

function ObligationsLoaded() {
  const list = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!list) return null;
  return <CommissionObligationsPage list={list} />;
}

/** A Commission's obligations as a platform admin sees them: the Commission staff's view. */
function CommissionObligationsPage({ list }: { list: DeclarationsResult<ObligationPage> | null }) {
  const { slug } = Route.useParams();
  const committed = Route.useSearch();
  const summary = layout.useLoaderData();
  const navigate = useNavigate({ from: '/commissions/$slug/obligations/' });
  const path = `/commissions/${slug}/obligations`;
  const pending = useRouterState({
    select: (state) =>
      state.status === 'pending' && state.location.pathname === path ? state.location.search : null,
  });
  const search = pending ? obligationsSearchSchema.parse(pending) : committed;

  const changeSearch = (next: ObligationsSearch, options?: { replace?: boolean }) => {
    void navigate({ search: next, replace: options?.replace });
  };

  const backToCommission = (
    <Button asChild variant="secondary" size="sm">
      <Link to="/commissions/$slug" params={{ slug }}>
        {m.backToCommission}
      </Link>
    </Button>
  );

  return (
    <ObligationsView
      summary={summary ?? null}
      list={pending ? null : list}
      search={search}
      onSearchChange={changeSearch}
      loadPage={(cursor) =>
        listCommissionObligations({
          data: { slug, ...committed, cursor, limit: OBLIGATIONS_PAGE_SIZE },
        })
      }
      loadObligation={(id) => getObligation({ data: { id } })}
      roster={{
        notOnboardedLink: (
          <Button asChild variant="secondary" size="sm" className="bg-card">
            <Link
              to="/commissions/$slug/records"
              params={{ slug }}
              search={{ state: 'not_onboarded' }}
            >
              <Icon icon={UserGroupIcon} />
              {m.viewRoster}
            </Link>
          </Button>
        ),
        recordLink: (declarant) => (
          <Button asChild variant="secondary">
            <Link
              to="/commissions/$slug/records/$recordId"
              params={{ slug, recordId: declarant.rosterRecordId }}
            >
              <Icon icon={UserGroupIcon} />
              {m.rosterRecord}
            </Link>
          </Button>
        ),
      }}
      forbiddenAction={backToCommission}
      notFoundAction={backToCommission}
    />
  );
}
