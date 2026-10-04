import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { messages as m } from '../../components/help/messages';
import {
  type HelpSession,
  HelpSessionContext,
  helpWorkspaceFor,
} from '../../components/help/scope';
import { goToSignIn, signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { previewHelpSearch } from '../../server/help';
import { getViewer } from '../../server/viewer';

/**
 * Help articles (spec 11 FE-4): a Commission's articles and question themes for its
 * administrators (who write) and reporting officers (who read), at the session's tenant; the
 * platform's articles and the legal corpus for platform admins. Anyone else is told they cannot.
 */
export const Route = createFileRoute('/help')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    const help = helpWorkspaceFor(roles, principal?.tenant ?? null);
    return {
      viewer,
      roles,
      help,
      workspace: help
        ? (workspaceFor(roles, 'platform-help') ?? workspaceFor(roles, 'help') ?? null)
        : null,
    };
  },
  staticData: {
    crumb: ({ context, isLeaf }) =>
      isLeaf ||
      (typeof context === 'object' && context !== null && 'help' in context && context.help)
        ? m.title
        : null,
  },
  component: HelpLayout,
});

function HelpLayout() {
  const { viewer, roles, workspace } = Route.useRouteContext();
  const [justPublished, setJustPublished] = useState<string | null>(null);
  const session = useMemo<HelpSession>(
    () => ({
      justPublished,
      setJustPublished,
      searchAsDeclarants: (data) => previewHelpSearch({ data }),
      onUnauthenticated: () => {
        goToSignIn();
      },
    }),
    [justPublished],
  );
  return (
    <WorkspaceLayout
      viewer={viewer}
      roles={roles}
      workspace={workspace}
      title={m.title}
      forbidden={m.forbiddenText}
    >
      <HelpSessionContext value={session}>
        <Outlet />
      </HelpSessionContext>
    </WorkspaceLayout>
  );
}
