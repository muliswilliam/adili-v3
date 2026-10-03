import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  EmptyState,
  formatDate,
  formatDateTime,
  Icon,
  IntakeStatusBadge,
  RateBar,
  Skeleton,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ApiIcon,
  Download04Icon,
  Globe02Icon,
  InboxIcon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import type { EaccResult, ReportView } from '../../server/eacc-intake.server';
import type { SubmittedReport } from '../../server/reporting/types';
import { problemStatus } from '../../server/service-call';
import {
  AccessSection,
  ClarificationsSection,
  ComplaintsCard,
  DeclarationSections,
  PartHeading,
  PartICard,
  PartIIICard,
} from '../form-m/form-m-document';
import { messages as formM } from '../form-m/messages';
import { LoadError } from '../load-error';
import { Page } from '../page';
import { daysLate } from './intake-view';
import { messages as m } from './messages';
import { INTAKE_SECTIONS, OutlierChips } from './outlier-chips';

export interface ReportViewerProps {
  /** The report; null while it loads. */
  result: EaccResult<ReportView> | null;
  /** "All reports", back to the intake for the report's year. */
  backLink: ReactNode;
  /** Downloads a filed document (the PDF or the receipt); resolves false when it failed. */
  onDownload: (documentId: string) => Promise<boolean>;
}

/**
 * EACC's report viewer (spec 09 FE-3, S9): a Commission's Form M as filed, read-only, with its
 * reference, when and how it came in, who compiled and confirmed it, the Restricted PDF and the
 * signed receipt, and beside it the report's rates, outliers and chases. The form is Form M
 * workspace's read-only rendering (`form-m-document.tsx`), as the Commission sees it.
 */
export function ReportViewer({ result, backLink, onDownload }: ReportViewerProps) {
  return (
    <Page>
      <div className="mb-3 text-[13.5px] font-medium text-secondary-foreground">{backLink}</div>
      {result === null ? (
        <ViewerSkeleton />
      ) : result.ok ? (
        <Report view={result.data} onDownload={onDownload} />
      ) : problemStatus(result) === 404 ? (
        <Card className="p-0 sm:p-0">
          <EmptyState
            icon={<Icon icon={InboxIcon} />}
            title={m.reportNotFoundTitle}
            description={m.reportNotFoundText}
          />
        </Card>
      ) : (
        <LoadError
          title={m.reportErrorTitle}
          detail={
            result.error.kind === 'unavailable' && result.error.detail
              ? result.error.detail
              : m.loadErrorDetail
          }
          retryLabel={m.tryAgain}
        />
      )}
    </Page>
  );
}

function Report({
  view,
  onDownload,
}: {
  view: ReportView;
  onDownload: ReportViewerProps['onDownload'];
}) {
  const { report } = view;
  const { document } = report;
  return (
    <>
      <ReportHead report={report} onDownload={onDownload} />
      <Facts report={report} />
      <div className="mt-4 grid grid-cols-1 items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <PartICard partI={document.partI} />
          <PartHeading>{formM.partII}</PartHeading>
          <DeclarationSections partII={document.partII} />
          <ClarificationsSection clarifications={document.partII.clarifications} />
          <AccessSection
            accessRequests={document.partII.accessRequests}
            dataUnavailable={report.accessDataUnavailable}
          />
          <ComplaintsCard complaints={document.partII.complaints} />
          <PartIIICard partIII={document.partIII} />
        </div>
        <aside className="flex flex-col gap-4 min-[1100px]:sticky min-[1100px]:top-20">
          <Rates view={view} />
          <Outliers view={view} />
          <Chasing view={view} />
        </aside>
      </div>
    </>
  );
}

function ReportHead({
  report,
  onDownload,
}: {
  report: SubmittedReport;
  onDownload: ReportViewerProps['onDownload'];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const download = async (documentId: string | null) => {
    if (!documentId) return;
    setBusy(documentId);
    setFailed(false);
    const saved = await onDownload(documentId);
    setBusy(null);
    setFailed(!saved);
  };
  const federated = report.source === 'federated';
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] min-[700px]:text-[26px]">
            {report.commission.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <IntakeStatusBadge status={report.late ? 'submitted-late' : 'submitted-on-time'} />
            <Badge className="pl-[7px]">
              <Icon icon={federated ? ApiIcon : Globe02Icon} />
              {m.submittedVia[report.source]}
            </Badge>
            <Badge
              variant="warning"
              className="pl-[7px] text-[11.5px] font-semibold tracking-[0.04em] uppercase"
            >
              <Icon icon={SquareLock02Icon} />
              {m.restricted}
            </Badge>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            disabled={!report.formMDocumentId || busy !== null}
            onClick={() => void download(report.formMDocumentId)}
          >
            <Icon icon={Download04Icon} />
            {m.downloadFormM}
          </Button>
          <Button
            variant="secondary"
            aria-label={m.downloadReceipt}
            disabled={!report.receiptDocumentId || busy !== null}
            onClick={() => void download(report.receiptDocumentId)}
          >
            <Icon icon={Download04Icon} />
            {m.receipt}
          </Button>
        </div>
      </div>
      {failed ? (
        <Alert variant="destructive" className="mt-3">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>{m.downloadFailed}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] font-medium text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[14.5px] font-medium break-words">{children}</dd>
    </div>
  );
}

/** The report's reference, when it came in and for which year, and who signed it off. */
function Facts({ report }: { report: SubmittedReport }) {
  const headingId = useId();
  const late = report.late && report.submittedAt ? daysLate(report.submittedAt, report.dueDate) : 0;
  const { compiledBy, confirmedBy } = report.document.partIII;
  return (
    <Card asChild className="p-0 sm:p-0">
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="sr-only">
          {m.reportDetails}
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 px-5 py-4 min-[700px]:grid-cols-3">
          <Fact term={m.reference}>
            <span className="font-mono text-[14px]">{report.reference ?? m.none}</span>
          </Fact>
          <Fact term={m.submitted}>
            {report.submittedAt ? formatDateTime(report.submittedAt) : m.none}
            {late > 0 ? (
              <span className="ml-1 text-warning-subtle-foreground">({m.daysLate(late)})</span>
            ) : null}
          </Fact>
          <Fact term={m.period}>
            {m.periodLine(m.fyLabel(report.fy), formatDate(report.dueDate))}
          </Fact>
          <Fact term={m.compiledBy}>{compiledBy.name ?? report.reviewedBy?.name ?? m.none}</Fact>
          <Fact term={m.confirmedBy}>{confirmedBy.name ?? report.confirmedBy?.name ?? m.none}</Fact>
        </dl>
      </section>
    </Card>
  );
}

/** A card in the viewer's side column, labelled by its heading. */
function SideCard({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <Card asChild className="gap-3 px-5 py-[18px] sm:px-5 sm:py-[18px]">
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="text-[15.5px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {children}
      </section>
    </Card>
  );
}

/**
 * Declared over expected per section: the intake's rates, as the table shows them; the report's
 * own counts when the intake could not be read.
 */
function Rates({ view }: { view: ReportView }) {
  return (
    <SideCard title={m.rates}>
      <dl className="grid gap-3.5">
        {INTAKE_SECTIONS.map((section) => {
          const { declared, expected } =
            view.intake?.rates[section] ?? view.report.document.partII[section];
          return (
            <div key={section}>
              <dt className="mb-1 text-[13.5px] font-medium">{m.rateOf[section]}</dt>
              <dd>
                <RateBar declared={declared} expected={expected} size="lg" />
              </dd>
            </div>
          );
        })}
      </dl>
    </SideCard>
  );
}

function Outliers({ view }: { view: ReportView }) {
  const outliers = view.intake?.outliers;
  return (
    <SideCard title={m.outliers}>
      {outliers === undefined ? (
        <p className="text-[13.5px] text-muted-foreground">{m.outliersUnavailable}</p>
      ) : outliers.length === 0 ? (
        <p className="text-[13.5px] text-muted-foreground">{m.noOutliers}</p>
      ) : (
        <OutlierChips outliers={outliers} />
      )}
    </SideCard>
  );
}

/** EACC's chases before the report came in; nothing when there were none. */
function Chasing({ view }: { view: ReportView }) {
  const chases = view.intake?.chases;
  if (!chases?.lastAt || chases.count === 0) return null;
  return (
    <SideCard title={m.chasing}>
      <p className="text-[13.5px] text-muted-foreground">
        {m.chased(chases.count, formatDate(chases.lastAt))}
      </p>
    </SideCard>
  );
}

function ViewerSkeleton() {
  return (
    <div aria-busy="true" aria-label={m.loadingReport} className="flex flex-col gap-4">
      <Skeleton className="h-8 w-80 max-w-full" />
      <Skeleton className="h-5 w-64 max-w-full" />
      <Card aria-hidden="true" className="grid gap-3 p-5 sm:p-5">
        <Skeleton className="w-1/3" />
        <Skeleton className="w-1/2" />
      </Card>
      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
        <Card aria-hidden="true" className="h-80" />
        <Card aria-hidden="true" className="h-48" />
      </div>
    </div>
  );
}
