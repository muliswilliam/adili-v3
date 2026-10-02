import { Button, Card, EmptyState, GRANTED_ACCESS_STATUSES, Icon, useToast } from '@adili/ui';
import { ArrowLeft01Icon, File01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import { REQUEST_COPY as COPY } from '../../../access/copy';
import { AccessShell } from '../../../components/access/access-shell';
import { RequestPage } from '../../../components/access/request-page';
import { NotApplicantNotice, UnavailableNotice } from '../../../components/access/request-status';
import { WithdrawDialog } from '../../../components/access/withdraw-dialog';
import { signInRedirect } from '../../../components/declaration/route-helpers';
import { usePoll } from '../../../components/declaration/use-poll';
import { isUuid } from '../../../declaration/section-key';
import { getMyAccessRequest, withdrawMyAccessRequest } from '../../../server/access-requests';

/** One of the applicant's Form K requests (spec 10 FE-3), with withdraw until a decision. */
export const Route = createFileRoute('/access/requests/$id')({
  loader: async ({ params, location }) => {
    if (!isUuid(params.id)) throw notFound();
    const result = await getMyAccessRequest({ data: { requestId: params.id } });
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.status === 'ok'
            ? `${loaderData.request.reference} · Adili Online`
            : 'Access request · Adili Online',
      },
    ],
  }),
  notFoundComponent: () => (
    <AccessShell>
      <RequestNotFound />
    </AccessShell>
  ),
  component: RequestRoute,
});

function RequestNotFound() {
  return (
    <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start px-4 pt-6 pb-16 sm:px-7 sm:pt-10">
      <Card>
        <EmptyState
          className="py-14"
          icon={<Icon icon={File01Icon} />}
          title={COPY.notFoundTitle}
          description={COPY.notFoundText}
          action={
            <Button asChild variant="secondary">
              <Link to="/access/requests" search={{}}>
                {COPY.back}
              </Link>
            </Button>
          }
        />
      </Card>
    </main>
  );
}

/** How often, and how many times, a package being prepared is read again (ten minutes). */
const PREPARING_POLL_MS = 15_000;
const PREPARING_POLLS = 40;

function RequestRoute() {
  return (
    <AccessShell>
      <Request />
    </AccessShell>
  );
}

function Request() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const { toast } = useToast();
  const [withdrawing, setWithdrawing] = useState(false);
  // While a grant's package (or nil letter) is being prepared, read the request again now and
  // then, so it shows once issued (or that issuing failed) without a manual reload.
  const preparing =
    result.status === 'ok' &&
    GRANTED_ACCESS_STATUSES.has(result.request.status) &&
    result.request.package === null &&
    result.request.packageFailedAt === null;
  usePoll({
    pollKey: preparing ? result.request.id : null,
    read: () => router.invalidate(),
    onRead: () => false,
    onGiveUp: () => undefined,
    intervalMs: PREPARING_POLL_MS,
    limit: PREPARING_POLLS,
  });

  if (result.status === 'not-found') return <RequestNotFound />;
  if (result.status !== 'ok') {
    return (
      <main className="mx-auto grid w-full max-w-[1000px] flex-1 content-start gap-4 px-4 pt-5 pb-16 sm:px-7 sm:pt-8">
        <Button asChild variant="ghost" size="sm" className="justify-self-start">
          <Link to="/access/requests" search={{}}>
            <Icon icon={ArrowLeft01Icon} />
            {COPY.back}
          </Link>
        </Button>
        {result.status === 'not-applicant' ? (
          <NotApplicantNotice />
        ) : (
          <UnavailableNotice title={COPY.unavailableTitle} text={COPY.unavailableText} />
        )}
      </main>
    );
  }
  const { request } = result;
  return (
    <>
      <RequestPage
        request={request}
        now={Date.parse(result.now)}
        onWithdraw={() => {
          setWithdrawing(true);
        }}
        onDownloaded={() => {
          void router.invalidate();
        }}
      />
      <WithdrawDialog
        open={withdrawing}
        reference={request.reference}
        commission={request.commission.name}
        withdraw={(idempotencyKey) =>
          withdrawMyAccessRequest({ data: { requestId: request.id, idempotencyKey } })
        }
        onWithdrawn={() => {
          setWithdrawing(false);
          toast({ title: COPY.withdrawn });
          void router.invalidate();
        }}
        onClose={(changed) => {
          setWithdrawing(false);
          if (changed) void router.invalidate();
        }}
      />
    </>
  );
}
