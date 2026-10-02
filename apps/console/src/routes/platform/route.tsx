import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { messages as m } from '../../components/platform/messages';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/**
 * Platform settings (the platform administrator's workspace): law-enforcement accounts so far
 * (spec 10 FE-6). Anyone else is told they cannot, as the directory answers them 403.
 */
export const Route = createFileRoute('/platform')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    return { viewer, roles, workspace: workspaceFor(roles, 'platform') ?? null };
  },
  component: PlatformLayout,
});

function PlatformLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.workspaceTitle} />
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
          <PageHead title={m.workspaceTitle} />
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
