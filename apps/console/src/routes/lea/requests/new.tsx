import { createFileRoute } from '@tanstack/react-router';

import { messages as m } from '../../../components/lea/messages';
import { NewRequestForm } from '../../../components/lea/new-request-form';
import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getRequestCommissions } from '../../../server/lea-requests';

/** A new written request to a Commission (spec 10 FE-6, S11). */
export const Route = createFileRoute('/lea/requests/new')({
  loader: async ({ location, context }) => {
    if (!context.workspace) return null;
    const result = await getRequestCommissions();
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  staticData: { crumb: m.newTitle },
  head: () => ({ meta: [{ title: `${m.newTitle} · Adili Online Console` }] }),
  component: NewRequestRoute,
});

function NewRequestRoute() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return (
    <Page narrow>
      {result.ok ? (
        <NewRequestForm commissions={result.data} />
      ) : (
        <>
          <PageHead title={m.newTitle} />
          <LoadError
            title={m.commissionsFailed}
            detail={m.listErrorDetail}
            retryLabel={m.tryAgain}
          />
        </>
      )}
    </Page>
  );
}
