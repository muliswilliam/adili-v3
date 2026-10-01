import { Button } from '@adili/ui';
import { createFileRoute, Link, useRouter, useRouterState } from '@tanstack/react-router';

import { IntegrationsView } from '../../components/integrations/integrations-view';
import { messages as m } from '../../components/integrations/messages';
import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import type {
  IntegrationGatewayResult,
  SystemCoverage,
} from '../../server/integration-gateway/client';
import { getIntegrationsCoverage } from '../../server/integrations';
import { getViewer } from '../../server/viewer';

/** The coverage and when it was read. */
interface IntegrationsData {
  coverage: IntegrationGatewayResult<SystemCoverage[]>;
  loadedAt: string;
}

/** Platform settings: how each registry integration behaves (spec 07b FE-3). Platform admins. */
export const Route = createFileRoute('/platform/integrations')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, workspace: workspaceFor(roles, 'platform') ?? null };
  },
  loader: async ({ context, location }): Promise<IntegrationsData | null> => {
    // The page shows why there is no workspace; do not fetch coverage.
    if (!context.workspace) return null;
    const coverage = await getIntegrationsCoverage();
    if (!coverage.ok && coverage.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return { coverage, loadedAt: new Date().toISOString() };
  },
  staticData: { crumb: m.title },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: IntegrationsLoading,
  component: IntegrationsPage,
});

function IntegrationsLoading() {
  return <IntegrationsLayout loaded={null} />;
}

function IntegrationsPage() {
  const loaded = Route.useLoaderData();
  return <IntegrationsLayout loaded={loaded} />;
}

function IntegrationsLayout({ loaded }: { loaded: IntegrationsData | null }) {
  const { viewer, roles, workspace } = Route.useRouteContext();
  const router = useRouter();
  const refreshing = useRouterState({ select: (state) => state.isLoading });
  const backToOverview = (
    <Button asChild variant="secondary" size="sm">
      <Link to="/">{m.backToOverview}</Link>
    </Button>
  );
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.title} />
          <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
        </Page>
      ) : !workspace ? (
        <Page narrow>
          <PageHead title={m.title} />
          {workspacesFor(roles).length > 0 ? (
            <NoAccess text={m.forbidden} action={backToOverview} />
          ) : (
            <NoStaffRoles />
          )}
        </Page>
      ) : (
        <IntegrationsView
          result={loaded?.coverage ?? null}
          loadedAt={loaded?.loadedAt ?? null}
          refreshing={refreshing}
          onRefresh={() => void router.invalidate()}
          forbiddenAction={backToOverview}
        />
      )}
    </ConsoleShell>
  );
}
