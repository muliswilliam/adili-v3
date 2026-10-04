import { SUPERVISOR } from '@adili/roles';
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as t } from '../../components/referrals/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/**
 * The Referrals workspace of the viewer's own Commission (spec 08 FE-6; the session's tenant,
 * no slug in the URL): its reviewers and supervisors see the referrals to EACC; supervisors
 * decide them. Anyone else is told they cannot.
 */
export const Route = createFileRoute('/referrals')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    return {
      viewer,
      roles,
      tenant: principal?.tenant ?? null,
      workspace: workspaceFor(roles, 'referrals') ?? null,
      supervisor: roles.includes(SUPERVISOR),
    };
  },
  staticData: { crumb: t.title },
  component: ReferralsLayout,
});

function ReferralsLayout() {
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
