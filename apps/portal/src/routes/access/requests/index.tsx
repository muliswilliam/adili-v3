import { useToast } from '@adili/ui';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { REQUEST_COPY, REQUESTS_COPY as COPY } from '../../../access/copy';
import { AccessShell } from '../../../components/access/access-shell';
import { NotApplicantNotice, UnavailableNotice } from '../../../components/access/request-status';
import { NewRequestButton, RequestsList } from '../../../components/access/requests-list';
import { WithdrawDialog } from '../../../components/access/withdraw-dialog';
import { signInRedirect } from '../../../components/declaration/route-helpers';
import { getMyAccessRequests, withdrawMyAccessRequest } from '../../../server/access-requests';
import type { RequestSummary } from '../../../server/access-requests.server';

/**
 * My requests (spec 10 FE-3): the applicant's Form K requests, ten to a page (`?page=2`), each
 * open one withdrawable and each granted one downloadable from its row. The acknowledgement and
 * decision notifications link here.
 */
export const Route = createFileRoute('/access/requests/')({
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).optional().catch(undefined),
  }),
  loader: async ({ location }) => {
    const result = await getMyAccessRequests();
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: 'My requests · Adili Online' }] }),
  component: MyRequestsRoute,
});

function MyRequestsRoute() {
  return (
    <AccessShell current="requests">
      <MyRequests />
    </AccessShell>
  );
}

/** Inside the shell, whose toasts the row actions use. */
function MyRequests() {
  const result = Route.useLoaderData();
  const { page } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const { toast } = useToast();
  const [withdrawing, setWithdrawing] = useState<RequestSummary | null>(null);
  const hasRequests = result.status === 'ok' && result.requests.length > 0;
  return (
    <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start gap-6 px-4 pt-6 pb-16 sm:px-7 sm:pt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{COPY.title}</h1>
        {hasRequests ? <NewRequestButton /> : null}
      </div>
      {result.status === 'ok' ? (
        <RequestsList
          requests={result.requests}
          page={page ?? 1}
          now={Date.parse(result.now)}
          onPage={(next) => {
            void navigate({ search: { page: next === 1 ? undefined : next } });
            window.scrollTo(0, 0);
          }}
          actions={{
            onWithdraw: setWithdrawing,
            onChanged: () => void router.invalidate(),
          }}
        />
      ) : result.status === 'not-applicant' ? (
        <NotApplicantNotice />
      ) : (
        <UnavailableNotice title={COPY.unavailableTitle} text={COPY.unavailableText} />
      )}
      {withdrawing ? (
        <WithdrawDialog
          open
          reference={withdrawing.reference}
          commission={withdrawing.commission.name}
          withdraw={(idempotencyKey) =>
            withdrawMyAccessRequest({ data: { requestId: withdrawing.id, idempotencyKey } })
          }
          onWithdrawn={() => {
            setWithdrawing(null);
            toast({ title: REQUEST_COPY.withdrawn });
            void router.invalidate();
          }}
          onClose={(changed) => {
            setWithdrawing(null);
            if (changed) void router.invalidate();
          }}
        />
      ) : null}
    </main>
  );
}
