import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Icon,
  SiteFooter,
  SiteHeader,
  ToastProvider,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ClarificationPage } from '../../components/clarification/clarification-page';
import { COPY } from '../../clarification/copy';
import { isUuid } from '../../declaration/section-key';
import { settleLoad } from '../../components/declaration/route-helpers';
import { SignOutButton } from '../../components/sign-out-button';
import { HelpLink } from '../../components/help/parts';
import { getMyClarification } from '../../server/clarifications';

/** A clarification from the declarant's Commission, and their response to it (spec 07a FE-5). */
export const Route = createFileRoute('/clarifications/$id')({
  loader: async ({ params, location }) => {
    if (!isUuid(params.id)) throw notFound();
    const load = await getMyClarification({ data: { clarificationId: params.id } });
    if (load.status === 'not-found') throw notFound();
    return settleLoad(load, location.href);
  },
  head: () => ({ meta: [{ title: 'Clarification · Adili Online' }] }),
  component: ClarificationRoute,
  notFoundComponent: () => (
    <Page>
      <main className="mx-auto grid w-full max-w-xl flex-1 content-start gap-4 px-4 py-16 text-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.015em]">{COPY.notFoundTitle}</h1>
        <p className="text-muted-foreground">{COPY.notFoundBody}</p>
        <Button asChild variant="secondary" className="justify-self-center">
          <Link to="/clarifications">{COPY.allClarifications}</Link>
        </Button>
      </main>
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
      {children}
      <SiteFooter />
    </ToastProvider>
  );
}

function ClarificationRoute() {
  const load = Route.useLoaderData();
  const router = useRouter();
  return (
    <Page>
      {load.status === 'ok' ? (
        <ClarificationPage
          // A reload after a conflict brings the sent response: start from it.
          key={`${load.clarification.id}:${load.clarification.status}`}
          clarification={load.clarification}
          followUps={load.followUps}
          original={load.original}
          now={load.now}
        />
      ) : (
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertTitle>{COPY.unavailableTitle}</AlertTitle>
            <AlertDescription className="grid justify-items-start gap-2.5">
              <p>{COPY.unavailableBody}</p>
              <Button variant="secondary" size="sm" onClick={() => void router.invalidate()}>
                {COPY.tryAgain}
              </Button>
            </AlertDescription>
          </Alert>
        </main>
      )}
    </Page>
  );
}
