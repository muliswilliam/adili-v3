import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../../components/load-error';
import { messages as m } from '../../../components/open-data/messages';
import { Page, PageHead } from '../../../components/page';
import { ConsoleShell } from '../../../components/shell/console-shell';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../../components/workspaces';
import { getViewer } from '../../../server/viewer';

/**
 * EACC's open-data releases (spec 09b FE-3, #350): EACC analysts and supervisors. The list is the
 * index; a release (a preview, or a published or withdrawn one) is `$releaseId`.
 */
export const Route = createFileRoute('/eacc/open-data')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    return {
      viewer,
      roles: principal?.roles ?? [],
      workspace: workspaceFor(principal?.roles ?? [], 'open-data') ?? null,
    };
  },
  staticData: { crumb: m.title },
  component: OpenDataLayout,
});

function OpenDataLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} organisation={viewer.organisation} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.title} />
          <LoadError title={m.loadErrorTitle} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
        </Page>
      ) : workspace ? (
        <Outlet />
      ) : (
        <Page narrow>
          <PageHead title={m.title} />
          {workspacesFor(roles).length > 0 ? (
            <NoAccess
              text={m.noAccess}
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
