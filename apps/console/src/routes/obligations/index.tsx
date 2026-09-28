import { Button, Icon } from '@adili/ui';
import { Settings01Icon, Upload04Icon, UserGroupIcon } from '@hugeicons/core-free-icons';
import {
  createFileRoute,
  getRouteApi,
  Link,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';

import { messages as m } from '../../components/obligations/messages';
import {
  OBLIGATIONS_PAGE_SIZE,
  type ObligationsSearch,
  obligationsSearchSchema,
} from '../../components/obligations/obligations-query';
import { ObligationsView } from '../../components/obligations/obligations-view';
import { messages as policyMessages } from '../../components/policy/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { ROSTER_WRITE_ROLES, workspaceFor } from '../../components/workspaces';
import type { DeclarationsResult, ObligationPage } from '../../server/declarations/client';
import { getObligation, listCommissionObligations } from '../../server/obligations';

const PATH = '/obligations';

/** A Commission role without a tenant: a broken account, shown as a failed load. */
const noCommission: DeclarationsResult<never> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

export const Route = createFileRoute('/obligations/')({
  validateSearch: obligationsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({
    deps,
    location,
    context,
  }): Promise<DeclarationsResult<ObligationPage> | null> => {
    // The layout shows no list without the workspace; do not fetch one.
    if (!context.workspace) return null;
    const slug = context.tenant;
    if (!slug) return noCommission;
    const list = await listCommissionObligations({
      data: { slug, ...deps, limit: OBLIGATIONS_PAGE_SIZE },
    });
    if (!list.ok && list.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return list;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: ObligationsLoading,
  component: ObligationsLoaded,
});

const layout = getRouteApi('/obligations');

function ObligationsLoading() {
  return <ObligationsPage list={null} />;
}

function ObligationsLoaded() {
  const list = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!list) return null;
  return <ObligationsPage list={list} />;
}

/** The workspace page; `list` is null while the first page loads. */
function ObligationsPage({ list }: { list: DeclarationsResult<ObligationPage> | null }) {
  const committed = Route.useSearch();
  const { roles, tenant } = Route.useRouteContext();
  const data = layout.useLoaderData();
  const navigate = useNavigate({ from: `${PATH}/` });
  // Filter changes keep this page mounted (and the search box focused) while the loader runs;
  // the toolbar shows the filters being loaded rather than the previous ones.
  const pending = useRouterState({
    select: (state) =>
      state.status === 'pending' && state.location.pathname === PATH ? state.location.search : null,
  });
  const search = pending ? obligationsSearchSchema.parse(pending) : committed;
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
      list={pending ? null : list}
      search={search}
      onSearchChange={changeSearch}
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link to="/obligations/policy">
            <Icon icon={Settings01Icon} />
            {policyMessages.openPolicy}
          </Link>
        </Button>
      }
      loadPage={(cursor) =>
        listCommissionObligations({
          data: { slug: tenant ?? '', ...committed, cursor, limit: OBLIGATIONS_PAGE_SIZE },
        })
      }
      loadObligation={(id) => getObligation({ data: { id } })}
      roster={
        opensRoster
          ? {
              notOnboardedLink: (
                <Button asChild variant="secondary" size="sm" className="bg-card">
                  <Link to="/roster/records" search={{ state: 'not_onboarded' }}>
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
