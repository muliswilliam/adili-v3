import { createFileRoute, getRouteApi } from '@tanstack/react-router';

import { RequestDetailView } from '../../../../components/access/request-detail';

const request = getRouteApi('/access/requests/$requestId');

/** The request page: Form K, the register, and the step it is at. */
export const Route = createFileRoute('/access/requests/$requestId/')({
  component: RequestPage,
});

function RequestPage() {
  const load = request.useLoaderData();
  const { workspace } = request.useRouteContext();
  if (!load?.ok || !workspace) return null;
  const { view, now } = load.data;
  return (
    <RequestDetailView
      // A new status starts the step's forms again (a verified request opens Identify officer).
      key={`${view.id}:${view.status}:${view.resolvedRosterRecordId ?? ''}`}
      view={view}
      readOnly={workspace.readOnly}
      now={now}
    />
  );
}
