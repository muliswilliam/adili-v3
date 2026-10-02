import { createFileRoute, getRouteApi } from '@tanstack/react-router';

import { LeaRequestDetail } from '../../../../components/access/lea/lea-request-detail';

const parent = getRouteApi('/access/lea-requests/$leaRequestId');

/** The law enforcement request page: verify, decide, the decision and its package. */
export const Route = createFileRoute('/access/lea-requests/$leaRequestId/')({
  component: LeaRequestPage,
});

function LeaRequestPage() {
  const load = parent.useLoaderData();
  const { workspace } = parent.useRouteContext();
  if (!load?.ok || !workspace) return null;
  const { request, now } = load.data;
  return (
    <LeaRequestDetail
      // A new status starts the step's forms again (a verified request opens Decide).
      key={`${request.id}:${request.status}`}
      request={request}
      readOnly={workspace.readOnly}
      now={now}
    />
  );
}
