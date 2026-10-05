import { createFileRoute, Outlet } from '@tanstack/react-router';

import { signInRedirect } from '../../components/sign-in-redirect';
import { messages as t } from '../../components/support/messages';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/** Account support (spec 03) for the helpdesk: a person's account by officer reference. */
export const Route = createFileRoute('/support')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, workspace: workspaceFor(roles, 'support') ?? null };
  },
  staticData: { crumb: t.title },
  component: SupportLayout,
});

function SupportLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <WorkspaceLayout
      viewer={viewer}
      roles={roles}
      workspace={workspace}
      title={t.title}
      forbidden={t.noAccess}
    >
      <Outlet />
    </WorkspaceLayout>
  );
}
