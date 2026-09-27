import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages } from '../../components/commissions/messages';
import { loginRedirect } from '../../components/login-redirect';
import { NoStaffRoles } from '../../components/no-staff-roles';
import { Page } from '../../components/page';
import { ConsoleShell } from '../../components/shell/console-shell';
import { workspaceAccess } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/** Whether a match's route context opens the Commissions workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'access' in context
    ? Boolean(context.access)
    : false;
}

export const Route = createFileRoute('/commissions')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw loginRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, access: workspaceAccess('commissions', roles) };
  },
  head: () => ({ meta: [{ title: 'Commissions · Adili Online Console' }] }),
  staticData: {
    // Staff without the workspace get no trail back to a list they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? messages.title : null),
  },
  component: CommissionsLayout,
});

function CommissionsLayout() {
  const { viewer, roles, access } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {access ? (
        <Outlet />
      ) : (
        // Spec 01: users without the workspace get the existing "No staff roles" state.
        <Page narrow>
          <NoStaffRoles />
        </Page>
      )}
    </ConsoleShell>
  );
}
