import { createFileRoute } from '@tanstack/react-router';

import { messages as m } from '../../../components/lea/messages';
import { MyRequests, NewRequestButton } from '../../../components/lea/my-requests';
import { Page, PageHead } from '../../../components/page';
import { signInRedirect } from '../../../components/sign-in-redirect';
import type { AccessResult } from '../../../server/access-requests.server';
import type { LeaRequest } from '../../../server/access/types';
import { getMyLeaRequests } from '../../../server/lea-requests';

interface Loaded {
  result: AccessResult<LeaRequest[]>;
  now: string;
}

/** The officer's requests, latest first (spec 10 FE-6). */
export const Route = createFileRoute('/lea/requests/')({
  staticData: { hideBreadcrumbs: true },
  loader: async ({ location, context }): Promise<Loaded | null> => {
    if (!context.workspace) return null;
    const result = await getMyLeaRequests();
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { result, now: new Date().toISOString() };
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: () => <RequestsPage loaded={null} />,
  component: RequestsRoute,
});

function RequestsRoute() {
  const loaded = Route.useLoaderData();
  if (!loaded) return null;
  return <RequestsPage loaded={loaded} />;
}

function RequestsPage({ loaded }: { loaded: Loaded | null }) {
  const hasRequests = loaded?.result.ok === true && loaded.result.data.length > 0;
  return (
    <Page>
      <PageHead title={m.title} actions={hasRequests ? <NewRequestButton /> : null} />
      <MyRequests result={loaded?.result ?? null} now={loaded?.now ?? new Date().toISOString()} />
    </Page>
  );
}
