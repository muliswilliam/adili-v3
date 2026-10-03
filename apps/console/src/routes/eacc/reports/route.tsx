import { createFileRoute, Outlet, useMatches } from '@tanstack/react-router';

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
 * year and the report viewer, for EACC analysts and supervisors. Anyone else is told the intake
 * is not theirs, as the reporting service answers them 403, and finds no report (404).
 */
export const Route = createFileRoute('/eacc/reports')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    return {
      viewer,
      roles,
      // Who the viewer is, for the national report's author check (#233).
      subject: principal?.subject ?? null,
      workspace: workspaceFor(roles, 'compliance') ?? null,
    };
  },
  staticData: {
    // Staff without the workspace get no trail back to a page they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.title : null),
  },
  component: ComplianceReportsLayout,
});

function ComplianceReportsLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  // A report anyone else opens reads as not found, as the service answers (the prototype's
  // Commission roles), not as a page they may not open.
  const onReport = useMatches().some((match) => match.routeId === '/eacc/reports/$reportId');
  return (
    <WorkspaceLayout
      viewer={viewer}
      roles={roles}
      workspace={workspace}
      title={m.title}
      forbidden={m.forbidden}
      open={onReport}
    >
      <Outlet />
    </WorkspaceLayout>
  );
}
