import { createFileRoute, getRouteApi } from '@tanstack/react-router';

import { DecidePage } from '../../../../components/access/decide-page';
import { messages as d } from '../../../../components/access/decision/messages';

const request = getRouteApi('/access/requests/$requestId');

/** The access officer's decision on a request under decision (#260), from its Decide button. */
export const Route = createFileRoute('/access/requests/$requestId/decide')({
  staticData: { crumb: d.decideCrumb },
  head: () => ({ meta: [{ title: `${d.decideTitle} · Adili Online Console` }] }),
  component: DecideRoute,
});

function DecideRoute() {
  const load = request.useLoaderData();
  const { workspace } = request.useRouteContext();
  if (!load?.ok || !workspace) return null;
  const { view } = load.data;
  return <DecidePage key={`${view.id}:${view.status}`} view={view} readOnly={workspace.readOnly} />;
}
