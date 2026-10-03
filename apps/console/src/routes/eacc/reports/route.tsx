import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../../components/load-error';
import { messages as m } from '../../../components/national-report/messages';
import { Page, PageHead } from '../../../components/page';
import { ConsoleShell } from '../../../components/shell/console-shell';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../../components/workspaces';
import { getViewer } from '../../../server/viewer';

/**
 * EACC's compliance reports workspace (spec 09): EACC analysts and supervisors. The national
 * consolidated report lives at `ncr`; the intake of Commissions' Form M reports (#230) joins it.
 */
export const Route = createFileRoute('/eacc/reports')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    return {
      viewer,
      roles: principal?.roles ?? [],
      subject: principal?.subject ?? null,
      workspace: workspaceFor(principal?.roles ?? [], 'compliance') ?? null,
    };
  },
  staticData: { crumb: m.workspaceTitle },
  component: ComplianceReportsLayout,
});

function ComplianceReportsLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.workspaceTitle} />
          <LoadError title={m.loadErrorTitle} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
        </Page>
      ) : workspace ? (
        <Outlet />
      ) : (
        <Page narrow>
          <PageHead title={m.workspaceTitle} />
          {workspacesFor(roles).length > 0 ? (
            <NoAccess text={m.noAccess} action={<BackToOverview />} />
          ) : (
            <NoStaffRoles />
          )}
        </Page>
      )}
    </ConsoleShell>
  );
}

export function BackToOverview() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to="/">{m.backToOverview}</Link>
    </Button>
  );
}
