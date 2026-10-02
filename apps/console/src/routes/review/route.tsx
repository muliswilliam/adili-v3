import { SUPERVISOR } from '@adili/roles';
import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

const TITLE = 'Review queue';

/** Whether a match's route context opens the review workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/**
 * The review workspace: reviewers and supervisors of a Commission (spec 07a), the queue at
 * `/review` and its cases under it.
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
  staticData: {
    // Staff without the workspace get no trail back to a page they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? TITLE : null),
  },
  component: ReviewLayout,
});

function ReviewLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {!viewer.directory.ok ? (
        <Page narrow>
          <PageHead title={TITLE} />
          <LoadError
            title="We could not load your access"
            detail="Check your connection and try again."
            retryLabel="Try again"
          />
        </Page>
      ) : workspace ? (
        <Outlet />
      ) : (
        <Page narrow>
          <PageHead title={TITLE} />
          {workspacesFor(roles).length > 0 ? (
            <NoAccess
              text="You do not have access to the review queue."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/">Back to overview</Link>
                </Button>
              }
            />
          ) : (
            <NoStaffRoles />
          )}
        </Page>
      )}
    </ConsoleShell>
  );
}
