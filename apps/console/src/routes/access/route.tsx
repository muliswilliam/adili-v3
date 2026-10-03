import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../components/access/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
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
    <WorkspaceLayout
      viewer={viewer}
      roles={roles}
      workspace={workspace}
      title={m.title}
      forbidden={m.forbidden}
    >
      <Outlet />
    </WorkspaceLayout>
  );
}
