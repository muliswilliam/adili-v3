import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../components/lea/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
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
