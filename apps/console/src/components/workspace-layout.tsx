import { Button } from '@adili/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { Viewer } from '../server/viewer';
import { LoadError, NoAccess, NoStaffRoles } from './load-error';
import { Page, PageHead } from './page';
import { ConsoleShell } from './shell/console-shell';
import { type Workspace, workspacesFor } from './workspaces';

export const en = {
  accessErrorTitle: 'We could not load your access',
  accessErrorDetail: 'Check your connection and try again.',
  tryAgain: 'Try again',
  backToOverview: 'Back to overview',
};

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

const m = en;

/**
 * The layout guard of a workspace's routes: the console shell around the page when the viewer
 * has the workspace; otherwise, under the workspace's title, a retry when their access could not
 * be loaded, that it is not theirs (with the way back), or that the account has no staff role.
 * `open` renders the pages without the workspace too, for pages whose loaders refuse on their own.
 */
export function WorkspaceLayout({
  viewer,
  roles,
  workspace,
  title,
  forbidden,
  open = false,
  children,
}: {
  viewer: Viewer;
  roles: readonly string[];
  workspace: Workspace | null;
  /** The workspace's title, over the error or refusal. */
  title: string;
  /** Why the viewer cannot open it, e.g. "You do not have access to access requests." */
  forbidden: string;
  /** Render the pages even without the workspace, e.g. a review case that reads as missing (S18). */
  open?: boolean;
  /** The workspace's pages: the route's `Outlet`. */
  children: ReactNode;
}) {
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      {viewer.directory.ok && (workspace || open) ? (
        children
      ) : (
        <Page narrow>
          <PageHead title={title} />
          {!viewer.directory.ok ? (
            <LoadError
              title={m.accessErrorTitle}
              detail={m.accessErrorDetail}
              retryLabel={m.tryAgain}
            />
          ) : workspacesFor(roles).length > 0 ? (
            <NoAccess
              text={forbidden}
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
      )}
    </ConsoleShell>
  );
}
