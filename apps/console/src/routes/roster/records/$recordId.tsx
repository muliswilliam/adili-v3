import { createFileRoute, Link } from '@tanstack/react-router';

import { messages as m } from '../../../components/roster/messages';
import { RecordActions } from '../../../components/roster/record-actions';
import { RecordDetail, RecordDetailSkeleton } from '../../../components/roster/record-detail';
import {
  loadRosterRecord,
  recordCrumb,
  RecordLoadFailure,
} from '../../../components/roster/record-route';
import { signInRedirect } from '../../../components/sign-in-redirect';

export const Route = createFileRoute('/roster/records/$recordId')({
  loader: async ({ params, location, context }) => {
    // The layout shows no record without the workspace; do not fetch one.
    if (!context.workspace) return null;
    const result = await loadRosterRecord(context.tenant, params.recordId);
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.ok ? loaderData.data.fullName : m.record} · Adili Online Console` },
    ],
  }),
  staticData: { crumb: ({ loaderData }) => recordCrumb(loaderData) },
  pendingComponent: RecordDetailSkeleton,
  component: RosterRecordPage,
});

function RosterRecordPage() {
  const result = Route.useLoaderData();
  const { workspace, tenant } = Route.useRouteContext();
  if (!result || !workspace) return null;
  if (!result.ok) {
    return (
      <RecordLoadFailure
        result={result}
        backLink={
          <Link to="/roster/records" search={{}}>
            {m.backToRecords}
          </Link>
        }
      />
    );
  }
  return (
    <RecordDetail
      record={result.data}
      readOnly={workspace.readOnly}
      actions={
        workspace.readOnly || !tenant ? undefined : (
          <RecordActions slug={tenant} record={result.data} />
        )
      }
    />
  );
}
