import { createFileRoute, Outlet } from '@tanstack/react-router';

import { ConsoleHeader } from '../../components/console-header';
import { loginRedirect } from '../../components/login-redirect';
import { NoStaffRoles } from '../../components/no-staff-roles';
import { workspaceAccess } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

export const Route = createFileRoute('/commissions')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw loginRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, access: workspaceAccess('commissions', roles) };
  },
  head: () => ({ meta: [{ title: 'Commissions · Adili Online Console' }] }),
  component: CommissionsLayout,
});

function CommissionsLayout() {
  const { viewer, access } = Route.useRouteContext();
  return (
    <>
      <ConsoleHeader userName={viewer.user.name} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {access ? <Outlet /> : <NoStaffRoles />}
      </main>
    </>
  );
}
