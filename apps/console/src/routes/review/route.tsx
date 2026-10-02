import { SUPERVISOR } from '@adili/roles';
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

const TITLE = 'Review queue';

/**
 * The review workspace: reviewers and supervisors of a Commission (spec 07a). The queue itself
 * (`/review`) is not built yet, so this layout names no crumb of its own.
 */
export const Route = createFileRoute('/review')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return {
      viewer,
      roles,
      workspace: workspaceFor(roles, 'review') ?? null,
      supervisor: roles.includes(SUPERVISOR),
    };
  },
  component: ReviewLayout,
});

function ReviewLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <WorkspaceLayout
      viewer={viewer}
      roles={roles}
      workspace={workspace}
      title={TITLE}
      forbidden={'You do not have access to the review queue.'}
    >
      <Outlet />
    </WorkspaceLayout>
  );
}
