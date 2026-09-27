import { Alert, AlertDescription, Button, Card, EmptyState, Icon, Skeleton } from '@adili/ui';
import { InformationCircleIcon, Search01Icon, Upload04Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { formatDate, formatDateTime, formatNumber } from '../../../../components/format';
import { LoadError } from '../../../../components/load-error';
import { Page, PageHead } from '../../../../components/page';
import {
  ImportChannelBadge,
  CompletenessBadge,
  ImportStateBadge,
} from '../../../../components/roster/roster-badges';
import { StartedBy } from '../../../../components/roster/import-history-table';
import { importEnded } from '../../../../components/roster/import-progress';
import { importRunning, rowsPurged } from '../../../../components/roster/import-report';
import { ImportReportBody } from '../../../../components/roster/import-report-body';
import { messages as m } from '../../../../components/roster/messages';
import { useImportPolling } from '../../../../components/roster/use-import-polling';
import { FailureAlert, RunningProgress } from '../../../../components/roster/wizard-import-step';
import { signInRedirect } from '../../../../components/sign-in-redirect';
import type {
  DirectoryResult,
  RosterImport,
  RosterImportRowPage,
} from '../../../../server/directory/client';
import { getRosterImport, listRejectedRows } from '../../../../server/roster-imports';

interface ReportData {
  imp: DirectoryResult<RosterImport>;
  /** The first page of rejected rows, read alongside when the import ended with some. */
  rows?: DirectoryResult<RosterImportRowPage>;
}

/** Hidden: the directory answers 404 for another Commission's import too, so both read the same. */
function isHidden(result: DirectoryResult<unknown>): boolean {
  return (
    !result.ok &&
    result.error.kind === 'problem' &&
    (result.error.problem.status === 404 || result.error.problem.status === 403)
  );
}

/** Whether the report shows rejected rows the loader should read with the import. */
function showsRows(imp: RosterImport): boolean {
  return importEnded(imp) && (imp.counts?.rejected ?? 0) > 0 && !rowsPurged(imp);
}

/** The breadcrumb for a report match, from loader data the router only knows as `unknown`. */
function reportCrumb(loaderData: unknown): string | null {
  if (loaderData === undefined) return m.loading;
  if (loaderData === null || typeof loaderData !== 'object' || !('imp' in loaderData)) {
    return m.reportPageTitle;
  }
  const { imp } = loaderData as ReportData;
  return imp.ok ? formatDate(imp.data.startedAt) : m.reportPageTitle;
}

const returnTo = (importId: string) => `/roster/imports/${importId}`;

export const Route = createFileRoute('/roster/imports/$importId/')({
  loader: async ({ params, location, context }): Promise<ReportData | null> => {
    // The layout shows no report without the workspace; do not fetch one.
    if (!context.workspace) return null;
    if (!context.tenant) {
      return { imp: { ok: false, error: { kind: 'unavailable', detail: null } } };
    }
    const slug = context.tenant;
    const imp = await getRosterImport({ data: { slug, importId: params.importId } });
    if (!imp.ok && imp.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!imp.ok || !showsRows(imp.data)) return { imp };
    const rows = await listRejectedRows({ data: { slug, importId: params.importId } });
    if (!rows.ok && rows.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { imp, rows };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.imp.ok ? reportTitle(loaderData.imp.data) : m.reportPageTitle} · Adili Online Console`,
      },
    ],
  }),
  staticData: { crumb: ({ loaderData }) => reportCrumb(loaderData) },
  pendingComponent: ReportSkeleton,
  component: ImportReportPage,
});

function reportTitle(imp: RosterImport): string {
  return imp.channel === 'api' ? m.apiBatch : (imp.fileName ?? m.reportPageTitle);
}

function ImportReportPage() {
  const data = Route.useLoaderData();
  const { tenant } = Route.useRouteContext();
  if (!data) return null;
  const { imp } = data;
  if (imp.ok && tenant) {
    return <Report key={imp.data.id} imp={imp.data} slug={tenant} initialRows={data.rows} />;
  }
  if (isHidden(imp)) {
    return (
      <Page narrow>
        <Card className="p-2 sm:p-2">
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.importNotFoundTitle}
            description={m.importNotFoundText}
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to="/roster/imports">{m.backToHistory}</Link>
              </Button>
            }
          />
        </Card>
      </Page>
    );
  }
  return (
    <Page narrow>
      <PageHead title={m.reportPageTitle} />
      <LoadError
        title={m.reportErrorTitle}
        detail={
          (!imp.ok && imp.error.kind === 'unavailable' ? imp.error.detail : null) ?? m.errorDetail
        }
        retryLabel={m.tryAgain}
      />
    </Page>
  );
}

/**
 * One import's report (spec 02): what, when and by whom, then the live progress while it runs,
 * or why it stopped, and what it did with the rejected rows 50 to a page.
 */
function Report({
  imp: loaded,
  slug,
  initialRows,
}: {
  imp: RosterImport;
  slug: string;
  initialRows?: DirectoryResult<RosterImportRowPage>;
}) {
  const router = useRouter();
  const { workspace } = Route.useRouteContext();
  // A running import is polled until it ends; then the loader runs again for its rows.
  const polling = useImportPolling(importRunning(loaded) ? loaded.id : null, {
    read: (importId) => getRosterImport({ data: { slug, importId } }),
    onUnauthenticated: () => {
      window.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo(loaded.id))}`);
    },
    onEnded: () => {
      void router.invalidate();
    },
  });
  const imp = polling.imp && importRunning(loaded) ? polling.imp : loaded;
  const running = importRunning(imp);
  const failed = imp.state === 'failed';
  return (
    <Page>
      <PageHead
        title={<span className="break-words">{reportTitle(imp)}</span>}
        actions={
          // An HR system resends its batch itself; only a file is corrected here.
          failed && imp.channel === 'file' && workspace && !workspace.readOnly ? (
            <Button asChild>
              <Link to="/roster/import">
                <Icon icon={Upload04Icon} />
                {m.importCorrected}
              </Link>
            </Button>
          ) : null
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ImportChannelBadge channel={imp.channel} />
          <CompletenessBadge declaredComplete={imp.declaredComplete} />
          <ImportStateBadge state={imp.state} />
        </div>
      </PageHead>
      <ImportMeta imp={imp} />
      {running ? (
        <Card className="mt-5 gap-3.5">
          <RunningProgress imp={imp} />
          <Alert variant="neutral" role="note">
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>{m.canLeave}</AlertDescription>
          </Alert>
        </Card>
      ) : (
        <>
          {failed ? (
            <div className="mt-5">
              <FailureAlert imp={imp} />
              {imp.counts ? (
                <p className="mt-[18px] mb-2.5 text-[13px] text-muted-foreground">
                  {m.countsUpToStop}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className={failed ? '' : 'mt-5'}>
            <ImportReportBody
              imp={imp}
              readRows={(cursor) => listRejectedRows({ data: { slug, importId: imp.id, cursor } })}
              returnTo={returnTo(imp.id)}
              initialRows={initialRows}
            />
          </div>
        </>
      )}
    </Page>
  );
}

/** One label and value of the import's details (the prototype's `.kv`). */
function Meta({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-1 text-[15px] font-medium break-words">{children}</dd>
    </div>
  );
}

function None({ children }: { children: string }) {
  return <span className="font-normal text-muted-foreground">{children}</span>;
}

function ImportMeta({ imp }: { imp: RosterImport }) {
  return (
    <Card>
      <dl
        aria-label={m.reportDetails}
        className="grid grid-cols-2 gap-x-6 gap-y-4 min-[700px]:grid-cols-3 min-[1100px]:grid-cols-5"
      >
        <Meta term={m.metaStarted}>{formatDateTime(imp.startedAt)}</Meta>
        <Meta term={m.metaCompleted}>
          {imp.completedAt ? formatDateTime(imp.completedAt) : <None>{m.stillRunning}</None>}
        </Meta>
        <Meta term={m.metaStartedBy}>
          <StartedBy startedBy={imp.startedBy} />
        </Meta>
        <Meta term={m.metaSource}>
          {imp.channel === 'api' ? m.sourceApiBatch : (imp.format?.toUpperCase() ?? m.channelFile)}
        </Meta>
        <Meta term={m.metaRows}>
          {imp.totalRows !== null ? (
            formatNumber(imp.totalRows)
          ) : (
            <None>{importRunning(imp) ? m.rowsCounting : m.rowsNotRead}</None>
          )}
        </Meta>
      </dl>
    </Card>
  );
}

function ReportSkeleton() {
  return (
    <Page>
      <PageHead title={<Skeleton className="h-8 w-[280px]" />}>
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-6 w-[56px] rounded-full" />
          <Skeleton className="h-6 w-[104px] rounded-full" />
          <Skeleton className="h-6 w-[92px] rounded-full" />
        </div>
      </PageHead>
      <Card aria-busy="true" aria-label={m.loading}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 min-[700px]:grid-cols-3 min-[1100px]:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="grid gap-2">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-4 w-[120px]" />
            </div>
          ))}
        </div>
      </Card>
      <div className="mt-5 grid grid-cols-2 gap-3 min-[900px]:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-[92px] rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
