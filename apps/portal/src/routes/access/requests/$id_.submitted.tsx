import { createFileRoute, notFound } from '@tanstack/react-router';

import { REQUEST_COPY } from '../../../access/copy';
import { AccessShell } from '../../../components/access/access-shell';
import { NotApplicantNotice, UnavailableNotice } from '../../../components/access/request-status';
import { SubmittedRequest } from '../../../components/access/submitted-request';
import { signInRedirect } from '../../../components/declaration/route-helpers';
import { isUuid } from '../../../declaration/section-key';
import { getMyAccessRequest } from '../../../server/access-requests';

/** After Form K is filed (spec 10 FE-3): the ARQ reference and the acknowledgement. */
export const Route = createFileRoute('/access/requests/$id_/submitted')({
  loader: async ({ params, location }) => {
    if (!isUuid(params.id)) throw notFound();
    const result = await getMyAccessRequest({ data: { requestId: params.id } });
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    if (result.status === 'not-found') throw notFound();
    return result;
  },
  head: () => ({ meta: [{ title: 'Request submitted · Adili Online' }] }),
  component: SubmittedRoute,
});

function SubmittedRoute() {
  const result = Route.useLoaderData();
  return (
    <AccessShell>
      <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start px-4 pt-10 pb-16 sm:px-7 sm:pt-14">
        {result.status === 'ok' ? (
          <SubmittedRequest request={result.request} />
        ) : result.status === 'not-applicant' ? (
          <NotApplicantNotice />
        ) : (
          <UnavailableNotice
            title={REQUEST_COPY.unavailableTitle}
            text={REQUEST_COPY.unavailableText}
          />
        )}
      </main>
    </AccessShell>
  );
}
