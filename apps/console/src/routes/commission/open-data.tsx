import { Button } from '@adili/ui';
import { createFileRoute, Link } from '@tanstack/react-router';

import { LoadError, NoAccess, NoStaffRoles } from '../../components/load-error';
import { messages as m } from '../../components/open-data-preview/messages';
import {
  noAccessText,
  OpenDataPreview,
} from '../../components/open-data-preview/open-data-preview';
import { Page, PageHead } from '../../components/page';
import { ConsoleShell } from '../../components/shell/console-shell';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor, workspacesFor } from '../../components/workspaces';
import {
  getCommissionOpenDataPreview,
  type OpenDataPreviewLoad,
} from '../../server/open-data-preview';
import { getViewer } from '../../server/viewer';

/**
 * Commission settings > Open data preview (spec 09b FE-3, S6): the viewer's own Commission's rows
 * of the current open-data preview or latest release, for its commission admin (the session's
 * tenant; no slug in the URL). Its other staff and EACC are told it is not for them, and nothing
 * is fetched for them.
 */
export const Route = createFileRoute('/commission/open-data')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    return {
      viewer,
      roles,
      workspace: workspaceFor(roles, 'open-data-preview') ?? null,
    };
  },
  loader: async ({ context, location }): Promise<OpenDataPreviewLoad | null> => {
    if (!context.workspace) return null;
    const load = await getCommissionOpenDataPreview();
    if (!load.preview.ok && load.preview.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return load;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  staticData: { crumb: m.title },
  pendingComponent: OpenDataPreviewPending,
  component: OpenDataPreviewPage,
});

function OpenDataPreviewPending() {
  return <Layout load={null} />;
}

function OpenDataPreviewPage() {
  return <Layout load={Route.useLoaderData()} />;
}

function Layout({ load }: { load: OpenDataPreviewLoad | null }) {
  const { viewer, roles, workspace } = Route.useRouteContext();
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      <Page narrow>
        <PageHead title={m.title} />
        {!viewer.directory.ok ? (
          <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
        ) : workspace ? (
          <OpenDataPreview load={load} />
        ) : workspacesFor(roles).length > 0 ? (
          <NoAccess
            text={noAccessText(roles)}
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to="/">{m.backToOverview}</Link>
              </Button>
            }
          />
        ) : (
          <NoStaffRoles />
        )}
      </Page>
    </ConsoleShell>
  );
}
