import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../components/ai-policy/messages';
import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/** AI policy (spec 07c FE-4): platform admins only; everyone else is told they cannot. */
export const Route = createFileRoute('/ai-policy')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    return { viewer, roles, workspace: workspaceFor(roles, 'ai-policy') ?? null };
  },
  staticData: { crumb: m.title },
  component: AiPolicyLayout,
});

function AiPolicyLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} organisation={viewer.organisation} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.title} />
          <LoadError title={m.loadErrorTitle} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
        </Page>
      ) : workspace ? (
        <Outlet />
      ) : (
        <Page narrow>
          <PageHead title={m.title} />
          {workspacesFor(roles).length > 0 ? (
            <NoAccess text={m.forbiddenText} action={<BackToOverview />} />
          ) : (
            <NoStaffRoles />
          )}
        </Page>
      )}
    </ConsoleShell>
  );
}

export function BackToOverview() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to="/">{m.backToOverview}</Link>
    </Button>
  );
}
