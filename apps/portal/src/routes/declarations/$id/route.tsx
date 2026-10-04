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
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AskAdiliProvider } from '../../../components/assistant/ask-adili';
import {
  DeclarationNotFound,
  requireDeclarationId,
  settleLoad,
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
  loader: async ({ params, location }) =>
    settleLoad(
      await getDeclaration({ data: { declarationId: requireDeclarationId(params.id) } }),
      location.href,
    ),
  head: () => ({ meta: [{ title: 'Your declaration · Adili Online' }] }),
  component: WorkspaceRoute,
  notFoundComponent: () => (
    <Page>
      <DeclarationNotFound />
    </Page>
  ),
});

function Page({ children, footer = <SiteFooter /> }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <ToastProvider>
      <TooltipProvider>
        <SiteHeader actions={<SignOutButton />} />
        {children}
        {footer}
      </TooltipProvider>
    </ToastProvider>
  );
}

/** Ask Adili on every workspace screen, with the draft's sections and the step shown. */
function WithAskAdili({ step, children }: { step: string; children: ReactNode }) {
  const { declaration } = useWorkspace();
  return (
    <AskAdiliProvider declarationId={declaration.id} sections={declaration.sections} step={step}>
      {children}
      <SiteFooter />
    </AskAdiliProvider>
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
    <Page footer={null}>
      <WorkspaceProvider declaration={result.declaration} etag={result.etag}>
        <WithAskAdili step={step}>
          <main className="flex flex-1 flex-col">
            <WorkspaceLayout step={step}>
              <SectionOutlet />
            </WorkspaceLayout>
          </main>
        </WithAskAdili>
      </WorkspaceProvider>
    </Page>
  );
}
