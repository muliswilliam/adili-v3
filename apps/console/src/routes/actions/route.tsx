import { SUPERVISOR } from '@adili/roles';
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';

import { en as m } from '../../components/actions/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/**
 * The Actions workspace (spec 08 FE-5): the Commission's reviewers and supervisors follow the
 * administrative action ladders, approve or decline the steps drafted for them and, as supervisors, restart
 * a declined ladder. Anyone else is told they have no access to the list, but a ladder reads as
 * missing for them: that page's loader answers 404 without the workspace.
 */
export const Route = createFileRoute('/actions')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return {
      viewer,
      roles,
      slug: viewer.directory.ok ? viewer.directory.principal.tenant : null,
      workspace: workspaceFor(roles, 'actions') ?? null,
      supervisor: roles.includes(SUPERVISOR),
    };
  },
  staticData: { crumb: m.title },
  component: ActionsLayout,
});

function ActionsLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  const inLadder = useLocation({
    select: (location) => location.pathname.startsWith('/actions/'),
  });
  return (
    <WorkspaceLayout
      viewer={viewer}
      roles={roles}
      workspace={workspace}
      open={inLadder}
      title={m.title}
      forbidden={m.forbidden}
    >
      <Outlet />
    </WorkspaceLayout>
  );
}
