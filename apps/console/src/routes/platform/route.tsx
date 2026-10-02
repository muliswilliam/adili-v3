import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../components/platform/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
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
    <WorkspaceLayout
      viewer={viewer}
      roles={roles}
      workspace={workspace}
      title={m.workspaceTitle}
      forbidden={m.forbidden}
    >
      <Outlet />
    </WorkspaceLayout>
  );
}
