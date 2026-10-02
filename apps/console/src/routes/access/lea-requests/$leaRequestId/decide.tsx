import { createFileRoute, getRouteApi } from '@tanstack/react-router';

import { LeaDecidePage } from '../../../../components/access/lea/decide-page';
import { messages as m } from '../../../../components/access/lea/messages';

const parent = getRouteApi('/access/lea-requests/$leaRequestId');

/** Deciding a law enforcement request: grant or deny, final. */
export const Route = createFileRoute('/access/lea-requests/$leaRequestId/decide')({
  staticData: { crumb: m.decideCrumb },
  head: () => ({ meta: [{ title: `${m.decideTitle} · Adili Online Console` }] }),
  component: DecideRoute,
});

function DecideRoute() {
  const load = parent.useLoaderData();
  const { workspace } = parent.useRouteContext();
  if (!load?.ok || !workspace) return null;
  return <LeaDecidePage request={load.data.request} readOnly={workspace.readOnly} />;
}
