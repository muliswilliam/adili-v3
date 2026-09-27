import { Alert, AlertTitle, Button, Icon, Skeleton } from '@adili/ui';
import { SquareLock02Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';

import { ReadOnlyBadge } from '../../components/commissions/badges';
import { formatDate } from '../../components/format';
import { Page, PageHead } from '../../components/page';
import { FlaggedList } from '../../components/roster/flagged-list';
import { messages as m } from '../../components/roster/messages';
import { RECORDS_PAGE_SIZE } from '../../components/roster/records-query';
import { useRosterCommission } from '../../components/roster/use-roster-commission';
import { signInRedirect } from '../../components/sign-in-redirect';
import type { DirectoryResult, RosterRecordPage } from '../../server/directory/client';
import { listRosterRecords } from '../../server/roster-records';

interface FlaggedData {
  records: DirectoryResult<RosterRecordPage>;
}

/** A roster-workspace role without a tenant: a broken account, shown as a failed load. */
const noCommission: DirectoryResult<never> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

export const Route = createFileRoute('/roster/flagged')({
  loader: async ({ location, context }): Promise<FlaggedData | null> => {
    // The layout shows no list without the workspace; do not fetch one.
    if (!context.workspace) return null;
    const slug = context.tenant;
    if (!slug) return { records: noCommission };
    const records = await listRosterRecords({
      data: { slug, flagged: true, limit: RECORDS_PAGE_SIZE },
    });
    if (!records.ok && records.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return { records };
  },
  head: () => ({ meta: [{ title: `${m.flaggedTitlePage} · Adili Online Console` }] }),
  staticData: { crumb: m.flaggedTitlePage },
  pendingComponent: FlaggedLoading,
  component: FlaggedLoaded,
});

function FlaggedLoading() {
  return <FlaggedPage data={null} />;
}

function FlaggedLoaded() {
  const data = Route.useLoaderData();
  // The layout shows why there is no workspace.
  if (!data) return null;
  return <FlaggedPage data={data} />;
}

/** The flagged officers page (spec 02, Screen: Flagged officers); `data` is null while loading. */
function FlaggedPage({ data }: { data: FlaggedData | null }) {
  const { workspace, tenant } = Route.useRouteContext();
  const readOnly = workspace?.readOnly ?? true;
  const commission = useRosterCommission();
  const roster = commission?.ok ? commission.data.roster : null;
  const nobody = data?.records.ok === true && data.records.data.items.length === 0;
  const lastComplete = roster?.lastCompleteImportAt
    ? formatDate(roster.lastCompleteImportAt)
    : null;

  return (
    <Page>
      <PageHead title={m.flaggedTitlePage} actions={readOnly ? <ReadOnlyBadge /> : undefined}>
        {nobody || (data && !data.records.ok) ? null : (
          <p className="mt-1 max-w-[720px] text-sm text-muted-foreground">
            {data === null ? (
              <Skeleton className="my-1 inline-block w-[420px] max-w-full align-middle" />
            ) : readOnly ? (
              m.flaggedIntroReadOnly(lastComplete)
            ) : (
              m.flaggedIntro(lastComplete)
            )}
          </p>
        )}
      </PageHead>
      {readOnly && !nobody ? (
        <Alert variant="info" role="note" className="mb-4">
          <Icon icon={SquareLock02Icon} />
          <AlertTitle className="font-normal">{m.flaggedReadOnly}</AlertTitle>
        </Alert>
      ) : null}
      <FlaggedList
        slug={tenant ?? ''}
        result={data ? data.records : null}
        loadPage={(cursor) =>
          listRosterRecords({
            data: { slug: tenant ?? '', flagged: true, cursor, limit: RECORDS_PAGE_SIZE },
          })
        }
        recordLink={(record) => (
          <Link to="/roster/records/$recordId" params={{ recordId: record.id }}>
            {record.fullName}
          </Link>
        )}
        emptyAction={
          <Button asChild variant="secondary" size="sm">
            <Link to="/roster">{m.rosterOverview}</Link>
          </Button>
        }
        readOnly={readOnly}
      />
    </Page>
  );
}
