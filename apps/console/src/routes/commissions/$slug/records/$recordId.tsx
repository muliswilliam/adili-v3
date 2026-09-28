import { createFileRoute, Link } from '@tanstack/react-router';

import { AuditBanner } from '../../../../components/roster/audit-banner';
import { messages as m } from '../../../../components/roster/messages';
import { RecordDetail, RecordDetailSkeleton } from '../../../../components/roster/record-detail';
import {
  loadRosterRecord,
  recordCrumb,
  RecordLoadFailure,
} from '../../../../components/roster/record-route';
import { signInRedirect } from '../../../../components/sign-in-redirect';

export const Route = createFileRoute('/commissions/$slug/records/$recordId')({
  loader: async ({ params, location, context }) => {
    // The layout shows no Commission without the workspace; do not fetch the record.
    if (!context.workspace) return null;
    const result = await loadRosterRecord(params.slug, params.recordId);
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
  component: CommissionRecordPage,
});

/** One record as a platform admin sees it: in full, read only, with the audit notice. */
function CommissionRecordPage() {
  const result = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (!result) return null;
  if (!result.ok) {
    const forbidden = result.error.kind === 'problem' && result.error.problem.status === 403;
    return (
      <RecordLoadFailure
        result={result}
        banner={forbidden ? null : <AuditBanner slug={slug} />}
        backLink={
          <Link to="/commissions/$slug/records" params={{ slug }} search={{}}>
            {m.backToRecords}
          </Link>
        }
      />
    );
  }
  return <RecordDetail record={result.data} banner={<AuditBanner slug={slug} />} readOnly />;
}
