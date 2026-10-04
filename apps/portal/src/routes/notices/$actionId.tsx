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

import { settleLoad } from '../../components/declaration/route-helpers';
import { NoticePage } from '../../components/notices/notice-page';
import { SignOutButton } from '../../components/sign-out-button';
import { isUuid } from '../../declaration/section-key';
import { COPY } from '../../notices/copy';
import { getMyNotices } from '../../server/notices';

/**
 * A notice to comply or warning from the declarant's Commission, and their response to it (spec
 * 08 FE-7, S9, S17). The contract has no single-notice read, so the page reads the list.
 */
export const Route = createFileRoute('/notices/$actionId')({
  loader: async ({ params, location }) => {
    if (!isUuid(params.actionId)) throw notFound();
    const load = settleLoad(await getMyNotices(), location.href);
    if (load.status === 'ok' && !load.notices.some((each) => each.actionId === params.actionId)) {
      throw notFound();
    }
    return load;
  },
  head: () => ({ meta: [{ title: 'Notice · Adili Online' }] }),
  component: NoticeRoute,
  notFoundComponent: () => (
    <Page>
      <main className="mx-auto grid w-full max-w-xl flex-1 content-start gap-4 px-4 py-16 text-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.015em]">{COPY.notFoundTitle}</h1>
        <p className="text-muted-foreground">{COPY.notFoundBody}</p>
        <Button asChild variant="secondary" className="justify-self-center">
          <Link to="/notices">{COPY.allNotices}</Link>
        </Button>
      </main>
    </Page>
  ),
});

function Page({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SiteHeader actions={<SignOutButton />} />
      {children}
      <SiteFooter />
    </ToastProvider>
  );
}

function NoticeRoute() {
  const load = Route.useLoaderData();
  const { actionId } = Route.useParams();
  const router = useRouter();
  const notice =
    load.status === 'ok' ? load.notices.find((each) => each.actionId === actionId) : null;
  return (
    <Page>
      {load.status === 'ok' && notice ? (
        <NoticePage
          // A reload after a conflict brings the sent response: start from it.
          key={`${notice.actionId}:${notice.status}`}
          notice={notice}
          all={load.notices}
          now={load.now}
        />
      ) : (
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertTitle>{COPY.errorTitle}</AlertTitle>
            <AlertDescription className="grid justify-items-start gap-2.5">
              <p>{COPY.errorBody}</p>
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
