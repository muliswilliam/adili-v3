import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../components/access/messages';
import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/**
 * The Access requests workspace of the viewer's own Commission (spec 10 FE-5; the session's
 * tenant, no slug in the URL): its access officer works the requests, its supervisor reads them.
 * Anyone else is told they cannot, as the access service answers them 404.
 */
export const Route = createFileRoute('/access')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    return {
      viewer,
      roles,
      tenant: principal?.tenant ?? null,
      workspace: workspaceFor(roles, 'access') ?? null,
    };
  },
  component: AccessLayout,
});

function AccessLayout() {
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
