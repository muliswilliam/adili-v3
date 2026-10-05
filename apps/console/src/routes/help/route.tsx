import { createFileRoute, Outlet, retainSearchParams, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { messages as m } from '../../components/help/messages';
import {
  type HelpScopeChoice,
  helpScopeSearch,
  type HelpSession,
  HelpSessionContext,
  helpWorkspaceFor,
  helpWorkspacesFor,
} from '../../components/help/scope';
import { organisationLabel } from '../../components/organisation';
import { goToSignIn, signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { previewHelpSearch } from '../../server/help';
import { getViewer } from '../../server/viewer';

/**
 * Help articles (spec 11 FE-4): a Commission's articles and question themes for its
 * administrators (who write) and reporting officers (who read), at the session's tenant; the
 * platform's articles and the legal corpus for platform admins. A platform admin who also holds a
 * Commission role chooses between the two, kept in the URL (`scope`) on every help page. Anyone
 * else is told they cannot.
 */
export const Route = createFileRoute('/help')({
  validateSearch: helpScopeSearch,
  search: { middlewares: [retainSearchParams(['scope'])] },
  beforeLoad: async ({ location, search }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const principal = viewer.directory.ok ? viewer.directory.principal : null;
    const roles = principal?.roles ?? [];
    const tenant = principal?.tenant ?? null;
    const help = helpWorkspaceFor(roles, tenant, search.scope);
    const scopes: HelpScopeChoice[] = helpWorkspacesFor(roles, tenant).map(({ scope }) => ({
      kind: scope.kind,
      label:
        scope.kind === 'platform'
          ? m.scopePlatform
          : (organisationLabel(viewer.organisation) ?? scope.slug.toUpperCase()),
    }));
    return {
      viewer,
      roles,
      help,
      scopes,
      workspace: help
        ? (workspaceFor(roles, help.scope.kind === 'platform' ? 'platform-help' : 'help') ?? null)
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
  const { viewer, roles, workspace, scopes } = Route.useRouteContext();
  const navigate = useNavigate();
  const [justPublished, setJustPublished] = useState<string | null>(null);
  const session = useMemo<HelpSession>(
    () => ({
      justPublished,
      setJustPublished,
      searchAsDeclarants: (data) => previewHelpSearch({ data }),
      onUnauthenticated: () => {
        goToSignIn();
      },
      scopes,
      // The other help's tabs differ: start on its articles.
      chooseScope: (scope) => {
        void navigate({ to: '/help', search: { scope } });
      },
    }),
    [justPublished, scopes, navigate],
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
