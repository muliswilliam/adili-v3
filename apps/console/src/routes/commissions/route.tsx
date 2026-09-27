import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages } from '../../components/commissions/messages';
import { loginRedirect } from '../../components/login-redirect';
import { ConsoleShell } from '../../components/shell/console-shell';
import { workspaceAccess } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

export const Route = createFileRoute('/commissions')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw loginRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, access: workspaceAccess('commissions', roles) };
  },
  head: () => ({ meta: [{ title: 'Commissions · Adili Online Console' }] }),
  staticData: {
    // Staff without the workspace get "Not found" on a Commission, with no trail back to a list
    // they cannot open.
    crumb: ({ context, isLeaf }) =>
      isLeaf || (context as { access?: unknown } | undefined)?.access ? messages.title : null,
  },
  component: CommissionsLayout,
});

function CommissionsLayout() {
  const { viewer, roles } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      <Outlet />
    </ConsoleShell>
  );
}
