import { Button, Icon } from '@adili/ui';
import { Building03Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { messages as m } from '../../components/obligations/messages';
import { Page, PageHead } from '../../components/page';
import { rosterNavCounts } from '../../components/roster/nav-counts';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getCommission } from '../../server/commissions';
import type {
  CommissionObligationsSummary,
  DeclarationsResult,
} from '../../server/declarations/client';
import type { Commission, DirectoryResult } from '../../server/directory/client';
import { getCommissionObligationsSummary } from '../../server/obligations';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';
import { getViewer } from '../../server/viewer';

/** What every obligations page shares: the viewer's own Commission and its counts. */
export interface ObligationsLayoutData {
  /** For the sidebar's flagged count and whether the roster is still empty. */
  commission: DirectoryResult<Commission>;
  summary: DeclarationsResult<CommissionObligationsSummary>;
}

/** Whether a match's route context opens the Obligations workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/**
 * The Obligations workspace of the viewer's own Commission (the session's tenant; no slug in the
 * URL): reporting officers, reviewers, supervisors and commission admins. Platform admins reach
 * a Commission's obligations from its page; EACC staff see counts only.
 */
export const Route = createFileRoute('/obligations')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    return {
      viewer,
      roles,
      tenant: principal?.tenant ?? null,
      workspace: workspaceFor(roles, 'obligations') ?? null,
    };
  },
  // The counts do not follow the list's filters: changing them does not read the summary again.
  // Retry (router.invalidate) and coming back to the workspace do.
  shouldReload: ({ cause }) => cause !== 'stay',
  loader: async ({ context, location }): Promise<ObligationsLayoutData | null> => {
    if (!context.workspace) return null;
    const slug = context.tenant;
    if (!slug) return { commission: SERVICE_UNAVAILABLE, summary: SERVICE_UNAVAILABLE };
    const [commission, summary] = await Promise.all([
      getCommission({ data: { slug } }),
      getCommissionObligationsSummary({ data: { slug } }),
    ]);
    if (
      (!commission.ok && commission.error.kind === 'unauthenticated') ||
      (!summary.ok && summary.error.kind === 'unauthenticated')
    ) {
      throw signInRedirect(location.href);
    }
    return { commission, summary };
  },
  staticData: {
    // Staff without the workspace get no trail back to a page they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.title : null),
  },
  component: ObligationsLayout,
});

function ObligationsLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  const data = Route.useLoaderData();
  const roster = data?.commission.ok ? data.commission.data.roster : null;
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles} navCounts={rosterNavCounts(roster)}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.title} />
          <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
        </Page>
      ) : workspace ? (
        <Outlet />
      ) : (
        <Page narrow>
          <PageHead title={m.title} />
          <NoWorkspace roles={roles} />
        </Page>
      )}
    </ConsoleShell>
  );
}

/**
 * National roles see a Commission's obligations from its page (platform admins) or its counts
 * only (EACC); everyone else is told they cannot.
 */
function NoWorkspace({ roles }: { roles: readonly string[] }) {
  if (workspaceFor(roles, 'commissions')) {
    return (
      <NoAccess
        text={roles.includes('platform-admin') ? m.pickCommission : m.forbidden}
        action={<OpenCommissions />}
      />
    );
  }
  if (workspacesFor(roles).length === 0) return <NoStaffRoles />;
  return (
    <NoAccess
      text={m.noAccess}
      action={
        <Button asChild variant="secondary" size="sm">
          <Link to="/">{m.backToOverview}</Link>
        </Button>
      }
    />
  );
}

export function OpenCommissions() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to="/commissions">
        <Icon icon={Building03Icon} />
        {m.openCommissions}
      </Link>
    </Button>
  );
}
