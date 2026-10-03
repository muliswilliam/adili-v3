import {
  Alert,
  AlertDescription,
  AlertTitle,
  Icon,
  SiteFooter,
  SiteHeader,
  ToastProvider,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { createFileRoute, redirect } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import {
  DeclarationNotFound,
  requireDeclarationId,
  settleLoad,
} from '../../components/declaration/route-helpers';
import { SubmittedView } from '../../components/declaration/submitted-view';
import { SignOutButton } from '../../components/sign-out-button';
import { HelpLink } from '../../components/help/parts';
import { getMySlipContext, getMySubmission } from '../../server/submission';

/**
 * The submission success page (spec 06 FE-3), outside the workspace: the declaration is filed,
 * so there is nothing left to edit. A declaration not submitted yet goes back to its summary.
 */
export const Route = createFileRoute('/declarations/$id_/submitted')({
  loader: async ({ params, location }) => {
    const declarationId = requireDeclarationId(params.id);
    const [submission, slipContext] = await Promise.all([
      getMySubmission({ data: { declarationId } }),
      getMySlipContext(),
    ]);
    const load = settleLoad(submission, location.href);
    if (load.status === 'not-submitted') {
      throw redirect({ to: '/declarations/$id/summary', params: { id: declarationId } });
    }
    return { load, slip: settleLoad(slipContext, location.href) };
  },
  head: () => ({ meta: [{ title: 'Declaration submitted · Adili Online' }] }),
  component: SubmittedRoute,
  notFoundComponent: () => (
    <Page>
      <DeclarationNotFound />
    </Page>
  ),
});

function Page({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SiteHeader
        actions={
          <>
            <HelpLink />
            <SignOutButton />
          </>
        }
      />
      <main className="mx-auto w-full max-w-[760px] flex-1 px-4 py-10 sm:px-6">{children}</main>
      <SiteFooter />
    </ToastProvider>
  );
}

function SubmittedRoute() {
  const { load, slip } = Route.useLoaderData();
  return (
    <Page>
      {load.status === 'ok' ? (
        <SubmittedView declaration={load.declaration} version={load.version} slip={slip} />
      ) : (
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertTitle>We could not load your submission</AlertTitle>
          <AlertDescription>Reload the page, or try again in a few minutes.</AlertDescription>
        </Alert>
      )}
    </Page>
  );
}
