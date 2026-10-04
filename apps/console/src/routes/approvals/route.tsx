import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as t } from '../../components/approvals/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/**
 * The approvals workspace (spec 08 FE-3): a Commission's supervisors decide what reviewers and
 * the system propose. Anyone else is told it is not theirs.
 */
export const Route = createFileRoute('/approvals')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, workspace: workspaceFor(roles, 'approvals') ?? null };
  },
  staticData: { crumb: t.title },
  component: ApprovalsLayout,
});

function ApprovalsLayout() {
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
