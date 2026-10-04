import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../components/form-m/messages';
import { formMCapabilities } from '../../components/form-m/capabilities';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { getViewer } from '../../server/viewer';

/** Whether a match's route context opens the Form M workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/**
 * The Form M workspace of the viewer's own Commission (spec 09 FE-2; the session's tenant, no
 * slug in the URL): its supervisor, commission-admin and reporting officer. Anyone else is told
 * they cannot, as the reporting service answers them 404.
 */
export const Route = createFileRoute('/form-m')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    const workspace = workspaceFor(roles, 'form-m') ?? null;
    return {
      viewer,
      roles,
      tenant: principal?.tenant ?? null,
      workspace,
      capabilities: formMCapabilities(roles, workspace),
    };
  },
  staticData: {
    // Staff without the workspace get no trail back to a page they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.crumb : null),
  },
  component: FormMLayout,
});

function FormMLayout() {
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
