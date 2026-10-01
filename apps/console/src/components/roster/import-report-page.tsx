import {
  Alert,
  AlertDescription,
  Button,
  Card,
  EmptyState,
  formatDate,
  formatDateTime,
  Icon,
  Skeleton,
} from '@adili/ui';
import { InformationCircleIcon, Search01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type {
  DirectoryResult,
  RosterImport,
  RosterImportRowPage,
} from '../../server/directory/client';
import { getRosterImport, listRejectedRows } from '../../server/roster-imports';
import { formatNumber } from '../format';
import { LoadError } from '../load-error';
import { Page, PageHead } from '../page';
import { goToSignIn } from '../sign-in-redirect';
import { StartedBy } from './import-history-table';
import { importEnded } from './import-progress';
import { importRunning, rowsPurged } from './import-report';
import { ImportReportBody } from './import-report-body';
import { messages as m } from './messages';
import { CompletenessBadge, ImportChannelBadge, ImportStateBadge } from './roster-badges';
import { useImportPolling } from './use-import-polling';
import type { RejectedRowsPager } from './use-rejected-rows';
import { FailureAlert, RunningProgress } from './wizard-import-step';

/**
 * The import report page (spec 02), for the reporting officer's own Commission
 * (`/roster/imports/$importId`) and for platform admins and EACC on a Commission's page
 * (`/commissions/$slug/imports/$importId`). The routes load it and say where its links go.
 */

/** What a report route's loader reads. */
export interface ImportReportData {
  imp: DirectoryResult<RosterImport>;
  /** The page of rejected rows on show, read alongside when the import ended with some. */
  rows?: DirectoryResult<RosterImportRowPage>;
}

/** Hidden: the directory answers 404 for another Commission's import too, so both read the same. */
export function importHidden(result: DirectoryResult<unknown>): boolean {
  return (
    !result.ok &&
    result.error.kind === 'problem' &&
    (result.error.problem.status === 404 || result.error.problem.status === 403)
  );
}

/** Whether the report shows rejected rows the loader should read with the import. */
export function showsRows(imp: RosterImport): boolean {
  return importEnded(imp) && (imp.counts?.rejected ?? 0) > 0 && !rowsPurged(imp);
}

/**
 * Reads the import and, when the report shows rejected rows, the page of them the URL names.
 * `onUnauthenticated` throws the route's sign-in redirect.
 */
export async function loadImportReport(
  slug: string,
  importId: string,
  cursor: string | undefined,
  onUnauthenticated: () => never,
): Promise<ImportReportData> {
  const imp = await getRosterImport({ data: { slug, importId } });
  if (!imp.ok && imp.error.kind === 'unauthenticated') onUnauthenticated();
  if (!imp.ok || !showsRows(imp.data)) return { imp };
  const rows = await listRejectedRows({ data: { slug, importId, cursor } });
  if (!rows.ok && rows.error.kind === 'unauthenticated') onUnauthenticated();
  return { imp, rows };
}

/** The breadcrumb for a report match, from loader data the router only knows as `unknown`. */
export function importReportCrumb(loaderData: unknown): string | null {
  if (loaderData === undefined) return m.loading;
  if (loaderData === null || typeof loaderData !== 'object' || !('imp' in loaderData)) {
    return m.reportPageTitle;
  }
  const { imp } = loaderData as ImportReportData;
  return imp.ok ? formatDate(imp.data.startedAt) : m.reportPageTitle;
}

/** The page title of a report: the file's name, or that it was an HR system's batch. */
export function importReportTitle(imp: RosterImport): string {
  return imp.channel === 'api' ? m.apiBatch : (imp.fileName ?? m.reportPageTitle);
}

/** A report that could not be shown: not found (or not the viewer's), or a failed load. */
export function ImportReportUnavailable({
  imp,
  backLink,
}: {
  imp: DirectoryResult<RosterImport>;
  /** The way back from a report that is not found. */
  backLink: ReactNode;
}) {
  if (importHidden(imp)) {
    return (
      <Page narrow>
        <Card className="p-2 sm:p-2">
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.importNotFoundTitle}
            description={m.importNotFoundText}
            action={
              <Button asChild variant="secondary" size="sm">
                {backLink}
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
 * One import's report: what, when and by whom, then the live progress while it runs, or why it
 * stopped, and what it did with the rejected rows 50 to a page.
 */
export function ImportReport({
  imp: loaded,
  slug,
  returnTo,
  initialRows,
  rowsPager,
  actions,
  reportCsvUrl,
  reviewFlagged,
}: {
  imp: RosterImport;
  slug: string;
  /** The report's own URL, where signing in again comes back to. */
  returnTo: string;
  initialRows?: DirectoryResult<RosterImportRowPage>;
  rowsPager: RejectedRowsPager;
  /** The page's actions for the import as it now is, e.g. importing a corrected file. */
  actions?: (imp: RosterImport) => ReactNode;
  /** Where the console serves the import's rejected rows CSV. */
  reportCsvUrl: string;
  /** The way to review officers the import flagged as absent; null when the viewer may not. */
  reviewFlagged: ReactNode;
}) {
  const router = useRouter();
  // A running import is polled until it ends; then the loader runs again for its rows.
  const polling = useImportPolling(importRunning(loaded) ? loaded.id : null, {
    read: (importId) => getRosterImport({ data: { slug, importId } }),
    onUnauthenticated: () => {
      goToSignIn(returnTo);
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
        title={<span className="break-words">{importReportTitle(imp)}</span>}
        actions={actions?.(imp)}
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
                  {m.countsUpToStop(imp.processedRows, imp.totalRows)}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className={failed ? '' : 'mt-5'}>
            <ImportReportBody
              imp={imp}
              readRows={(cursor) => listRejectedRows({ data: { slug, importId: imp.id, cursor } })}
              returnTo={returnTo}
              initialRows={initialRows}
              rowsPager={rowsPager}
              reportCsvUrl={reportCsvUrl}
              reviewFlagged={reviewFlagged}
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

/** The report's shape while it loads. */
export function ImportReportSkeleton() {
  return (
    <Page>
      <PageHead title={<Skeleton className="h-8 w-[280px]" />}>
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-6 w-[56px] rounded-full" />
          <Skeleton className="h-6 w-[104px] rounded-full" />
          <Skeleton className="h-6 w-[92px] rounded-full" />
        </div>
      </PageHead>
      <Card role="status" aria-busy="true" aria-label={m.loading}>
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
