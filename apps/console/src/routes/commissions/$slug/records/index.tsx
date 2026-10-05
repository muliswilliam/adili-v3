import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router';

import { Page, PageHead } from '../../../../components/page';
import { type LoadedFor, useReloadingInPlace } from '../../../../components/reload-in-place';
import { AuditBanner } from '../../../../components/roster/audit-banner';
import { messages as m } from '../../../../components/roster/messages';
import { RecordsList, RecordsSubtitle } from '../../../../components/roster/records-list';
import {
  RECORDS_PAGE_SIZE,
  type RecordsSearch,
  recordsSearchSchema,
} from '../../../../components/roster/records-query';
import { signInRedirect } from '../../../../components/sign-in-redirect';
import type { DirectoryResult, RosterRecordPage } from '../../../../server/directory/client';
import { listRosterRecords } from '../../../../server/roster-records';

export const Route = createFileRoute('/commissions/$slug/records/')({
  staticData: { hideBreadcrumbs: true },
  validateSearch: recordsSearchSchema,
  // Filter changes reload this match in place, not as a new one: see `useReloadingInPlace`.
  shouldReload: true,
  loader: async ({ params, location, context }) => {
    // The layout shows no Commission without the workspace; do not fetch its records.
    if (!context.workspace) return null;
    const result = await listRosterRecords({
      data: {
        slug: params.slug,
        ...recordsSearchSchema.parse(location.search),
        limit: RECORDS_PAGE_SIZE,
      },
    });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { result, loadedFor: location.searchStr };
  },
  head: () => ({ meta: [{ title: `${m.recordsTitle} · Adili Online Console` }] }),
  pendingComponent: RecordsLoading,
  component: RecordsLoaded,
});

const commissionRoute = getRouteApi('/commissions/$slug');

function RecordsLoading() {
  return <CommissionRecordsPage loaded={null} />;
}

function RecordsLoaded() {
  const loaded = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!loaded) return null;
  return <CommissionRecordsPage loaded={loaded} />;
}

/** A Commission's records as a platform admin sees them: the reporting officer's list, read only. */
function CommissionRecordsPage({
  loaded,
}: {
  loaded: (LoadedFor & { result: DirectoryResult<RosterRecordPage> }) | null;
}) {
  const result = loaded?.result ?? null;
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const commission = commissionRoute.useLoaderData();
  const navigate = useNavigate({ from: '/commissions/$slug/records/' });
  const loading = useReloadingInPlace(loaded);
  const roster = commission?.ok ? commission.data.roster : null;
  const forbidden =
    result?.ok === false && result.error.kind === 'problem' && result.error.problem.status === 403;

  const changeSearch = (next: RecordsSearch, options?: { replace?: boolean }) => {
    void navigate({ search: next, replace: options?.replace });
  };

  return (
    <Page narrow={forbidden}>
      {forbidden ? null : <AuditBanner slug={slug} />}
      <PageHead title={m.recordsTitle}>
        {forbidden ? null : <RecordsSubtitle expected={roster?.expectedDeclarants ?? null} />}
      </PageHead>
      <RecordsList
        result={loading ? null : result}
        search={search}
        onSearchChange={changeSearch}
        loadPage={(cursor) =>
          listRosterRecords({ data: { slug, ...search, cursor, limit: RECORDS_PAGE_SIZE } })
        }
        recordLink={(record) => (
          <Link to="/commissions/$slug/records/$recordId" params={{ slug, recordId: record.id }}>
            {record.fullName}
          </Link>
        )}
        flaggedCount={roster?.flagged}
        readOnly
      />
    </Page>
  );
}
