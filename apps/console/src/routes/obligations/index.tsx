import { Button, Icon } from '@adili/ui';
import { Settings01Icon, Upload04Icon, UserGroupIcon } from '@hugeicons/core-free-icons';
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router';

import { messages as m } from '../../components/obligations/messages';
import {
  OBLIGATIONS_PAGE_SIZE,
  type ObligationsSearch,
  obligationsSearchSchema,
} from '../../components/obligations/obligations-query';
import { notOnboardedRosterLink } from '../../components/obligations/roster-links';
import { ObligationsView } from '../../components/obligations/obligations-view';
import { messages as policyMessages } from '../../components/policy/messages';
import { type LoadedFor, useReloadingInPlace } from '../../components/reload-in-place';
import { signInRedirect } from '../../components/sign-in-redirect';
import { opensOwnPolicy, ROSTER_WRITE_ROLES, workspaceFor } from '../../components/workspaces';
import type { DeclarationsResult, ObligationPage } from '../../server/declarations/client';
import { getObligation, listCommissionObligations } from '../../server/obligations';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';

const PATH = '/obligations';

export const Route = createFileRoute('/obligations/')({
  validateSearch: obligationsSearchSchema,
  // Filter changes reload this match in place, not as a new one: see `useReloadingInPlace`.
  shouldReload: true,
  loader: async ({
    location,
    context,
  }): Promise<(LoadedFor & { list: DeclarationsResult<ObligationPage> }) | null> => {
    // The layout shows no list without the workspace; do not fetch one.
    if (!context.workspace) return null;
    const slug = context.tenant;
    if (!slug) return { list: SERVICE_UNAVAILABLE, loadedFor: location.searchStr };
    const list = await listCommissionObligations({
      data: {
        slug,
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

const layout = getRouteApi('/obligations');

function ObligationsLoading() {
  return <ObligationsPage loaded={null} />;
}

function ObligationsLoaded() {
  const loaded = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!loaded) return null;
  return <ObligationsPage loaded={loaded} />;
}

/** The workspace page; `loaded` is null while the first page loads. */
function ObligationsPage({
  loaded,
}: {
  loaded: (LoadedFor & { list: DeclarationsResult<ObligationPage> }) | null;
}) {
  const list = loaded?.list ?? null;
  const search = Route.useSearch();
  const { roles, tenant } = Route.useRouteContext();
  const data = layout.useLoaderData();
  const navigate = useNavigate({ from: `${PATH}/` });
  const loading = useReloadingInPlace(loaded);
  const roster = data?.commission.ok ? data.commission.data.roster : null;
  // The roster is the reporting officer's and the commission admin's; reviewers do not open it.
  const opensRoster = workspaceFor(roles, 'roster') !== undefined;
  const importsRoster = ROSTER_WRITE_ROLES.some((role) => roles.includes(role));

  const changeSearch = (next: ObligationsSearch, options?: { replace?: boolean }) => {
    void navigate({ search: next, replace: options?.replace });
  };

  return (
    <ObligationsView
      summary={data?.summary ?? null}
      list={loading ? null : list}
      search={search}
      onSearchChange={changeSearch}
      actions={
        // The policy is the commission admin's (spec 04 access table).
        opensOwnPolicy(roles) ? (
          <Button asChild variant="secondary" size="sm">
            <Link to="/obligations/policy">
              <Icon icon={Settings01Icon} />
              {policyMessages.openPolicy}
            </Link>
          </Button>
        ) : undefined
      }
      loadPage={(cursor) =>
        listCommissionObligations({
          data: { slug: tenant ?? '', ...search, cursor, limit: OBLIGATIONS_PAGE_SIZE },
        })
      }
      loadObligation={(id) => getObligation({ data: { id } })}
      roster={
        opensRoster
          ? {
              notOnboardedLink: (
                <Button asChild variant="secondary" size="sm" className="bg-card">
                  <Link {...notOnboardedRosterLink()}>
                    <Icon icon={UserGroupIcon} />
                    {m.viewRoster}
                  </Link>
                </Button>
              ),
              recordLink: (declarant) => (
                <Button asChild variant="secondary">
                  <Link
                    to="/roster/records/$recordId"
                    params={{ recordId: declarant.rosterRecordId }}
                  >
                    <Icon icon={UserGroupIcon} />
                    {m.rosterRecord}
                  </Link>
                </Button>
              ),
            }
          : undefined
      }
      emptyAction={
        importsRoster && roster?.status === 'none' ? (
          <Button asChild variant="secondary" size="sm">
            <Link to="/roster/import">
              <Icon icon={Upload04Icon} />
              {m.importRoster}
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}
