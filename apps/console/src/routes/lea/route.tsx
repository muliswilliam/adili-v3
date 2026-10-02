import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../components/lea/messages';
import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/**
 * The law enforcement workspace (spec 10 FE-6): a provisioned officer files written requests to
 * any Commission, follows them and downloads what is granted. Anyone else is told they cannot,
 * as the access service answers them 403.
 */
export const Route = createFileRoute('/lea')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    return { viewer, roles, workspace: workspaceFor(roles, 'lea') ?? null };
  },
  component: LeaLayout,
});

function LeaLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.title} />
          <LoadError
            title={m.accessErrorTitle}
            detail={m.accessErrorDetail}
            retryLabel={m.tryAgain}
          />
        </Page>
      ) : workspace ? (
        <Outlet />
      ) : (
        <Page narrow>
          <PageHead title={m.title} />
          {workspacesFor(roles).length > 0 ? (
            <NoAccess
              text={m.forbidden}
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/">{m.backToOverview}</Link>
                </Button>
              }
            />
          ) : (
            <NoStaffRoles />
          )}
        </Page>
      )}
    </ConsoleShell>
  );
}
