import { Button, Icon } from '@adili/ui';
import { UserGroupIcon } from '@hugeicons/core-free-icons';
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router';

import { messages as m } from '../../../../components/obligations/messages';
import {
  OBLIGATIONS_PAGE_SIZE,
  type ObligationsSearch,
  obligationsSearchSchema,
} from '../../../../components/obligations/obligations-query';
import { commissionNotOnboardedRosterLink } from '../../../../components/obligations/roster-links';
import { ObligationsView } from '../../../../components/obligations/obligations-view';
import { type LoadedFor, useReloadingInPlace } from '../../../../components/reload-in-place';
import { signInRedirect } from '../../../../components/sign-in-redirect';
import type { DeclarationsResult, ObligationPage } from '../../../../server/declarations/client';
import { getObligation, listCommissionObligations } from '../../../../server/obligations';

export const Route = createFileRoute('/commissions/$slug/obligations/')({
  validateSearch: obligationsSearchSchema,
  // Filter changes reload this match in place, not as a new one: see `useReloadingInPlace`.
  shouldReload: true,
  loader: async ({ params, location, context }) => {
    // The layout shows no Commission without the workspace; do not fetch its obligations.
    if (!context.workspace) return null;
    const list = await listCommissionObligations({
      data: {
        slug: params.slug,
        ...obligationsSearchSchema.parse(location.search),
        limit: OBLIGATIONS_PAGE_SIZE,
      },
    });
    if (!list.ok && list.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { list, loadedFor: location.searchStr };
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: ObligationsLoading,
  component: ObligationsLoaded,
});

const layout = getRouteApi('/commissions/$slug/obligations');

function ObligationsLoading() {
  return <CommissionObligationsPage loaded={null} />;
}

function ObligationsLoaded() {
  const loaded = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!loaded) return null;
  return <CommissionObligationsPage loaded={loaded} />;
}

/** A Commission's obligations as a platform admin sees them: the Commission staff's view. */
function CommissionObligationsPage({
  loaded,
}: {
  loaded: (LoadedFor & { list: DeclarationsResult<ObligationPage> }) | null;
}) {
  const list = loaded?.list ?? null;
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const summary = layout.useLoaderData();
  const navigate = useNavigate({ from: '/commissions/$slug/obligations/' });
  const loading = useReloadingInPlace(loaded);

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
      list={loading ? null : list}
      search={search}
      onSearchChange={changeSearch}
      loadPage={(cursor) =>
        listCommissionObligations({
          data: { slug, ...search, cursor, limit: OBLIGATIONS_PAGE_SIZE },
        })
      }
      loadObligation={(id) => getObligation({ data: { id } })}
      roster={{
        notOnboardedLink: (
          <Button asChild variant="secondary" size="sm" className="bg-card">
            <Link {...commissionNotOnboardedRosterLink(slug)}>
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
