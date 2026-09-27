import { Button, Icon } from '@adili/ui';
import { Upload04Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useNavigate, useRouterState } from '@tanstack/react-router';

import { ReadOnlyBadge } from '../../../components/commissions/badges';
import { Page, PageHead } from '../../../components/page';
import { messages as m } from '../../../components/roster/messages';
import { RecordsList, RecordsSubtitle } from '../../../components/roster/records-list';
import {
  RECORDS_PAGE_SIZE,
  type RecordsSearch,
  recordsSearchSchema,
} from '../../../components/roster/records-query';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getCommission } from '../../../server/commissions';
import type {
  Commission,
  DirectoryResult,
  RosterRecordPage,
} from '../../../server/directory/client';
import { listRosterRecords } from '../../../server/roster-records';

const PATH = '/roster/records';

interface RecordsData {
  records: DirectoryResult<RosterRecordPage>;
  /** For the expected count and the flagged chip; the list stands without it. */
  commission: DirectoryResult<Commission>;
}

/** A roster-workspace role without a tenant: a broken account, shown as a failed load. */
const noCommission: DirectoryResult<never> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

export const Route = createFileRoute('/roster/records/')({
  validateSearch: recordsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, location, context }): Promise<RecordsData | null> => {
    // The layout shows no list without the workspace; do not fetch one.
    if (!context.workspace) return null;
    // Roster screens are about the viewer's own Commission, the tenant of their session.
    const slug = context.tenant;
    if (!slug) return { records: noCommission, commission: noCommission };
    const [records, commission] = await Promise.all([
      listRosterRecords({ data: { slug, ...deps, limit: RECORDS_PAGE_SIZE } }),
      getCommission({ data: { slug } }),
    ]);
    if (!records.ok && records.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return { records, commission };
  },
  head: () => ({ meta: [{ title: `${m.recordsTitle} · Adili Online Console` }] }),
  pendingComponent: RecordsLoading,
  component: RecordsLoaded,
});

function RecordsLoading() {
  return <RecordsPage data={null} />;
}

function RecordsLoaded() {
  const data = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!data) return null;
  return <RecordsPage data={data} />;
}

/** The records page; `data` is null while the first page loads. */
function RecordsPage({ data }: { data: RecordsData | null }) {
  const committed = Route.useSearch();
  const { workspace, tenant } = Route.useRouteContext();
  const navigate = useNavigate({ from: `${PATH}/` });
  const readOnly = workspace?.readOnly ?? true;
  // Filter changes keep this page mounted (and the search box focused) while the loader runs;
  // the toolbar shows the filters being loaded rather than the previous ones.
  const pending = useRouterState({
    select: (state) =>
      state.status === 'pending' && state.location.pathname === PATH ? state.location.search : null,
  });
  const search = pending ? recordsSearchSchema.parse(pending) : committed;
  const roster = data?.commission.ok ? data.commission.data.roster : null;

  const changeSearch = (next: RecordsSearch, options?: { replace?: boolean }) => {
    void navigate({ search: next, replace: options?.replace });
  };

  return (
    <Page>
      <PageHead title={m.recordsTitle} actions={readOnly ? <ReadOnlyBadge /> : <ImportButton />}>
        {data && !data.commission.ok ? null : (
          <RecordsSubtitle expected={roster?.expectedDeclarants ?? null} />
        )}
      </PageHead>
      <RecordsList
        result={pending || !data ? null : data.records}
        search={search}
        onSearchChange={changeSearch}
        loadPage={(cursor) =>
          listRosterRecords({
            data: { slug: tenant ?? '', ...committed, cursor, limit: RECORDS_PAGE_SIZE },
          })
        }
        recordLink={(record) => (
          <Link to="/roster/records/$recordId" params={{ recordId: record.id }}>
            {record.fullName}
          </Link>
        )}
        flaggedCount={roster?.flagged}
        emptyAction={readOnly ? undefined : <ImportButton size="sm" />}
        readOnly={readOnly}
      />
    </Page>
  );
}

function ImportButton({ size }: { size?: 'sm' }) {
  return (
    <Button asChild size={size}>
      <Link to="/roster/import">
        <Icon icon={Upload04Icon} />
        {m.importRoster}
      </Link>
    </Button>
  );
}
