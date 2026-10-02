import { SUPERVISOR } from '@adili/roles';
import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

const TITLE = 'Review queue';

/**
 * The review workspace: reviewers and supervisors of a Commission (spec 07a). The queue itself
 * (`/review`) is not built yet, so this layout names no crumb of its own. Anyone else is told
 * they have no access to the queue, but a case or clarification reads as missing for them
 * (S18): those pages' loaders answer 404 without the workspace.
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
  const inCase = useLocation({
    select: (location) => location.pathname.startsWith('/review/cases/'),
  });
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
      ) : workspace || inCase ? (
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
