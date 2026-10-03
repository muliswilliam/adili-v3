import { Button, Icon, useToast } from '@adili/ui';
import { Upload04Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useMatch, useNavigate, useRouter } from '@tanstack/react-router';

import { CoverageView } from '../../components/roster/coverage-view';
import { PROGRESS_ROUTE_LOADING } from '../../components/roster/declaration-progress';
import { messages as m } from '../../components/roster/messages';
import { useRosterCommission } from '../../components/roster/use-roster-commission';
import { signInRedirect } from '../../components/sign-in-redirect';
import { useRefreshOnFocus } from '../../components/use-refresh-on-focus';
import type { DeclarationProgress, DeclarationsResult } from '../../server/declarations/client';
import { getDeclarationProgress } from '../../server/obligations';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';

interface CoverageData {
  progress: DeclarationsResult<DeclarationProgress>;
  /** When the counts were read (ISO date-time). */
  loadedAt: string;
}

export const Route = createFileRoute('/roster/coverage')({
  // The cycle is counted by the service; the search and the page apply to the counts in hand.
  ...PROGRESS_ROUTE_LOADING,
  loader: async ({ context, deps, location }): Promise<CoverageData | null> => {
    // The layout shows why there is no workspace; do not fetch the counts.
    if (!context.workspace) return null;
    // Roster screens are about the viewer's own Commission, the tenant of their session.
    const slug = context.tenant;
    const loadedAt = new Date().toISOString();
    if (!slug) return { progress: SERVICE_UNAVAILABLE, loadedAt };
    const progress = await getDeclarationProgress({ data: { slug, cycle: deps.cycle } });
    if (!progress.ok && progress.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return { progress, loadedAt };
  },
  head: () => ({ meta: [{ title: `${m.coverageTitle} · Adili Online Console` }] }),
  staticData: { crumb: m.coverageTitle },
  pendingComponent: CoverageLoading,
  component: CoverageLoaded,
});

function CoverageLoading() {
  return <CoveragePage data={null} />;
}

function CoverageLoaded() {
  const data = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!data) return null;
  return <CoveragePage data={data} />;
}

/**
 * Roster > Coverage (#301): the counts are read again when the window regains focus and on
 * Refresh, in the background, so the page keeps showing the last ones meanwhile.
 */
function CoveragePage({ data }: { data: CoverageData | null }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/roster/coverage' });
  const router = useRouter();
  const { workspace } = Route.useRouteContext();
  const match = useMatch({ from: '/roster/coverage', shouldThrow: false });
  const commission = useRosterCommission();
  const readOnly = workspace?.readOnly ?? true;
  const { toast } = useToast();

  /** Reads the counts again, unless a read is under way; whether it did. */
  const refresh = async (): Promise<boolean> => {
    if (!data || match?.isFetching) return false;
    // This match alone: the roster layout keeps the Commission it loaded.
    await router.invalidate({ filter: (candidate) => candidate.routeId === '/roster/coverage' });
    return true;
  };
  useRefreshOnFocus(() => void refresh());

  return (
    <CoverageView
      result={data?.progress ?? null}
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, resetScroll: false });
      }}
      loadedAt={data?.loadedAt ?? null}
      refreshing={Boolean(data && match?.isFetching)}
      onRefresh={() => {
        void refresh().then((refreshed) => {
          if (refreshed) toast({ title: m.coverageRefreshed });
        });
      }}
      noRoster={commission?.ok === true && commission.data.roster.status === 'none'}
      noRosterAction={
        readOnly ? undefined : (
          <Button asChild size="sm">
            <Link to="/roster/import">
              <Icon icon={Upload04Icon} />
              {m.importRoster}
            </Link>
          </Button>
        )
      }
    />
  );
}
