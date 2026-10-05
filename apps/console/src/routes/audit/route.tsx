import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as t } from '../../components/audit/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/**
 * The audit trail (ADR-008) for auditors: its events and the integrity of its chains. Anyone else
 * is told they cannot.
 */
export const Route = createFileRoute('/audit')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, workspace: workspaceFor(roles, 'audit') ?? null };
  },
  staticData: { crumb: t.title },
  component: AuditLayout,
});

function AuditLayout() {
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
