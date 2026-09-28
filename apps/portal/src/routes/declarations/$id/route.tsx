import {
  Alert,
  AlertDescription,
  AlertTitle,
  Icon,
  SiteFooter,
  SiteHeader,
  ToastProvider,
  TooltipProvider,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { createFileRoute, notFound, Outlet, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import {
  DeclarationNotFound,
  requireDeclarationId,
  signInRedirect,
} from '../../../components/declaration/route-helpers';
import { stepFromPath } from '../../../components/declaration/steps';
import { useWorkspace, WorkspaceProvider } from '../../../components/declaration/workspace';
import { WorkspaceLayout } from '../../../components/declaration/workspace-layout';
import { SignOutButton } from '../../../components/sign-out-button';
import { getDeclaration } from '../../../server/declarations';

/**
 * The declaration workspace: loads the draft's header and section completeness, owns the
 * autosave queue, and renders the section navigation around each section route.
 */
export const Route = createFileRoute('/declarations/$id')({
  loader: async ({ params, location }) => {
    const result = await getDeclaration({
      data: { declarationId: requireDeclarationId(params.id) },
    });
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    if (result.status === 'not-found') throw notFound();
    return result;
  },
  head: () => ({ meta: [{ title: 'Your declaration · Adili Online' }] }),
  component: WorkspaceRoute,
  notFoundComponent: () => (
    <Page>
      <DeclarationNotFound />
    </Page>
  ),
});

function Page({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TooltipProvider>
        <SiteHeader actions={<SignOutButton />} />
        {children}
        <SiteFooter />
      </TooltipProvider>
    </ToastProvider>
  );
}

/** Remounts the section screen after a reload so it shows the reloaded contents. */
function SectionOutlet() {
  const { generation } = useWorkspace();
  return <Outlet key={generation} />;
}

function WorkspaceRoute() {
  const result = Route.useLoaderData();
  const { pathname } = useLocation();
  const step = stepFromPath(pathname) ?? 'overview';

  if (result.status === 'unavailable') {
    return (
      <Page>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertTitle>We could not load your declaration</AlertTitle>
            <AlertDescription>
              Your saved work is safe. Reload the page, or try again in a few minutes.
            </AlertDescription>
          </Alert>
        </main>
      </Page>
    );
  }

  return (
    <Page>
      <WorkspaceProvider declaration={result.declaration} etag={result.etag}>
        <main className="flex flex-1 flex-col">
          <WorkspaceLayout step={step}>
            <SectionOutlet />
          </WorkspaceLayout>
        </main>
      </WorkspaceProvider>
    </Page>
  );
}
