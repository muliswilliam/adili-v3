import { Button, Card, CardIcon, Icon } from '@adili/ui';
import { Building03Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { messages as m } from '../../components/roster/messages';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/** Whether a match's route context opens the Roster workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/**
 * The Roster workspace of the viewer's own Commission (the session's tenant; no slug in the URL):
 * reporting officers (write) and commission admins (read).
 */
export const Route = createFileRoute('/roster')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    return {
      viewer,
      roles,
      tenant: principal?.tenant ?? null,
      workspace: workspaceFor(roles, 'roster') ?? null,
    };
  },
  staticData: {
    // Staff without the workspace get no trail back to a page they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.title : null),
  },
  component: RosterLayout,
});

function RosterLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={m.title} />
          <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
        </Page>
      ) : workspace ? (
        <Outlet />
      ) : (
        <Page narrow>
          <PageHead title={m.title} />
          <NoWorkspace roles={roles} />
        </Page>
      )}
    </ConsoleShell>
  );
}

/** National roles reach rosters through each Commission; everyone else is told they cannot. */
function NoWorkspace({ roles }: { roles: readonly string[] }) {
  if (workspaceFor(roles, 'commissions')) {
    return (
      <Card className="flex-row items-start gap-3.5">
        <CardIcon className="mb-0 size-[38px] shrink-0 rounded-[10px] text-muted-foreground [&_svg]:size-[18px]">
          <Icon icon={Building03Icon} />
        </CardIcon>
        <div className="grid justify-items-start gap-1">
          <h2 className="font-semibold">{m.nationalTitle}</h2>
          <p className="text-sm text-muted-foreground">{m.nationalText}</p>
          <Button asChild size="sm" className="mt-2.5">
            <Link to="/commissions">
              <Icon icon={Building03Icon} />
              {m.nationalAction}
            </Link>
          </Button>
        </div>
      </Card>
    );
  }
  if (workspacesFor(roles).length === 0) return <NoStaffRoles />;
  return (
    <NoAccess
      text={m.forbidden}
      action={
        <Button asChild variant="secondary" size="sm">
          <Link to="/">{m.backToOverview}</Link>
        </Button>
      }
    />
  );
}
