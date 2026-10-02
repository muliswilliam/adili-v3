import { Button, Icon } from '@adili/ui';
import { Upload04Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { ReadOnlyBadge } from '../../../components/commissions/badges';
import { Page, PageHead } from '../../../components/page';
import { useReloadingInPlace } from '../../../components/reload-in-place';
import { messages as m } from '../../../components/roster/messages';
import { RecordsList, RecordsSubtitle } from '../../../components/roster/records-list';
import {
  RECORDS_PAGE_SIZE,
  type RecordsSearch,
  recordsSearchSchema,
} from '../../../components/roster/records-query';
import { useRosterCommission } from '../../../components/roster/use-roster-commission';
import { signInRedirect } from '../../../components/sign-in-redirect';
import type { DirectoryResult, RosterRecordPage } from '../../../server/directory/client';
import { listRosterRecords } from '../../../server/roster-records';
import { SERVICE_UNAVAILABLE } from '../../../server/service-call';

const PATH = '/roster/records';

interface RecordsData {
  records: DirectoryResult<RosterRecordPage>;
}

export const Route = createFileRoute('/roster/records/')({
  validateSearch: recordsSearchSchema,
  // Filter changes reload this match in place, not as a new one: see `useReloadingInPlace`.
  shouldReload: true,
  loader: async ({ location, context }): Promise<RecordsData | null> => {
    // The layout shows no list without the workspace; do not fetch one.
    if (!context.workspace) return null;
    // Roster screens are about the viewer's own Commission, the tenant of their session.
    const slug = context.tenant;
    if (!slug) return { records: SERVICE_UNAVAILABLE };
    const records = await listRosterRecords({
      data: { slug, ...recordsSearchSchema.parse(location.search), limit: RECORDS_PAGE_SIZE },
    });
    if (!records.ok && records.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return { records };
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
  const search = Route.useSearch();
  const { workspace, tenant } = Route.useRouteContext();
  const navigate = useNavigate({ from: `${PATH}/` });
  const readOnly = workspace?.readOnly ?? true;
  const loading = useReloadingInPlace();
  const commission = useRosterCommission();
  const roster = commission?.ok ? commission.data.roster : null;

  const changeSearch = (next: RecordsSearch, options?: { replace?: boolean }) => {
    void navigate({ search: next, replace: options?.replace });
  };

  return (
    <Page>
      <PageHead title={m.recordsTitle} actions={readOnly ? <ReadOnlyBadge /> : <ImportButton />}>
        {commission && !commission.ok ? null : (
          <RecordsSubtitle expected={roster?.expectedDeclarants ?? null} />
        )}
      </PageHead>
      <RecordsList
        result={loading || !data ? null : data.records}
        search={search}
        onSearchChange={changeSearch}
        loadPage={(cursor) =>
          listRosterRecords({
            data: { slug: tenant ?? '', ...search, cursor, limit: RECORDS_PAGE_SIZE },
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
