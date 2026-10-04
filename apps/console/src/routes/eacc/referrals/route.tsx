import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as t } from '../../../components/referral-intake/messages';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../../components/workspace-layout';
import { workspaceFor } from '../../../components/workspaces';
import { getViewer } from '../../../server/viewer';

/**
 * EACC's Referrals received (spec 09 FE-5): the referrals Commissions sent, for EACC analysts and
 * supervisors to hand to ICMS. Anyone else is told they cannot.
 */
export const Route = createFileRoute('/eacc/referrals')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, workspace: workspaceFor(roles, 'referrals-intake') ?? null };
  },
  staticData: { crumb: t.title },
  component: ReferralIntakeLayout,
});

function ReferralIntakeLayout() {
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
