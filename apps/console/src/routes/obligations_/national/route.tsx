import { Button, Icon } from '@adili/ui';
import { Calendar03Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../../components/load-error';
import { messages as m } from '../../../components/obligations/messages';
import { Page, PageHead } from '../../../components/page';
import { ConsoleShell } from '../../../components/shell/console-shell';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../../components/workspaces';
import { getViewer } from '../../../server/viewer';

/**
 * EACC's national obligations summary (spec 04 FE-5): EACC analysts and supervisors and platform
 * admins. Not under the Obligations workspace, which is one Commission's own.
 */
export const Route = createFileRoute('/obligations_/national')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, workspace: workspaceFor(roles, 'national-obligations') ?? null };
  },
  staticData: { crumb: m.nationalTitle },
  component: NationalLayout,
});

function NationalLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.nationalTitle} />
          <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
        </Page>
      ) : workspace ? (
        <Outlet />
      ) : (
        <Page narrow>
          <PageHead title={m.nationalTitle} />
          {workspacesFor(roles).length > 0 ? (
            <NoAccess
              text={m.nationalNoAccess}
              action={workspaceFor(roles, 'obligations') ? <OpenOwnObligations /> : undefined}
            />
          ) : (
            <NoStaffRoles />
          )}
        </Page>
      )}
    </ConsoleShell>
  );
}

export function OpenOwnObligations() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to="/obligations">
        <Icon icon={Calendar03Icon} />
        {m.openOwnObligations}
      </Link>
    </Button>
  );
}
