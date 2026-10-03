import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/eacc-intake/messages';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../../components/workspace-layout';
import { workspaceFor } from '../../../components/workspaces';
import { getViewer } from '../../../server/viewer';

/** Whether a match's route context opens the Compliance reports workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/**
 * EACC's compliance reports (spec 09 FE-3): the intake of every Commission's Form M per financial
 * year and the report viewer, for EACC analysts and supervisors. Anyone else is told the page is
 * not theirs, as the reporting service answers them 403.
 */
export const Route = createFileRoute('/eacc/reports')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, workspace: workspaceFor(roles, 'compliance') ?? null };
  },
  staticData: {
    // Staff without the workspace get no trail back to a page they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.crumb : null),
  },
  component: ComplianceReportsLayout,
});

function ComplianceReportsLayout() {
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
