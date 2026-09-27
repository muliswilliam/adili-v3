import { Button } from '@adili/ui';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { Lock } from 'lucide-react';

import { messages as m } from '../../components/commissions/messages';
import { ConsoleHeader } from '../../components/console-header';
import { LoadError, NoAccess } from '../../components/load-error';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/** The Commissions workspace: signed-in platform admins (write) and EACC analysts/supervisors (read). */
export const Route = createFileRoute('/commissions')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    return { viewer };
  },
  component: CommissionsLayout,
});

function CommissionsLayout() {
  const { viewer } = Route.useRouteContext();
  return (
    <>
      <ConsoleHeader userName={viewer.user.name} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {viewer.directory.ok ? (
          <WorkspaceGate roles={viewer.directory.principal.roles} />
        ) : (
          <div className="grid gap-6">
            <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
            <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
          </div>
        )}
      </main>
    </>
  );
}

function WorkspaceGate({ roles }: { roles: readonly string[] }) {
  if (workspaceFor(roles, 'commissions')) {
    return <Outlet />;
  }
  if (workspacesFor(roles).length > 0) {
    return (
      <div className="grid max-w-2xl gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
        <NoAccess
          text={m.forbidden}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/">{m.backToOverview}</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
      <Lock className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{m.noStaffRolesTitle}</p>
      <p className="text-sm text-muted-foreground">{m.noStaffRolesText}</p>
    </div>
  );
}
