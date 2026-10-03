import {
  Alert,
  AlertDescription,
  AutosaveFailure,
  Badge,
  Button,
  Card,
  EmptyState,
  formatDate,
  formatDateTime,
  Icon,
  NarrativeEditor,
  type NarrativeSection,
  ReferenceChip,
  type ReferencePart,
  Select,
  SelectItem,
  Skeleton,
  Spinner,
  useAutosave,
  useToast,
} from '@adili/ui';
import { EACC_ANALYST } from '@adili/roles';
import {
  AlertCircleIcon,
  Download04Icon,
  File01Icon,
  InboxIcon,
  InformationCircleIcon,
  PencilEdit02Icon,
  RefreshIcon,
  Stamp01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';

import type {
  NationalReportPage,
  NationalReportPdf,
  NationalReportResult,
} from '../../server/national-report.server';
import {
  type Narrative,
  NARRATIVE_SECTION_IDS,
  type NarrativeParagraph,
  type NationalReport,
} from '../../server/reporting/types';
import { problemStatus, type ServiceResult } from '../../server/service-call';
import { downloadFrom } from '../download';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { usePollWhile } from '../use-poll-while';
import { CommissionsTable, NationalTotals } from './aggregate-tables';
import { type ApproveReport, ApproveDialog } from './approve-dialog';
import { messages as m } from './messages';
import {
  approvalOf,
  dueDateOf,
  editorValueOf,
  fyLabel,
  type NarrativeEditorValue,
  narrativeTextOf,
  type NcrViewer,
  newReportsSince,
} from './model';

/** What the page knows of the panels spec 09b adds to it, for each to render. */
export interface NcrExtensionContext {
  report: NationalReport;
  /** The viewer writes the narrative (an EACC analyst, while the report is a draft). */
  canEdit: boolean;
}

/**
 * Where spec 09b's panels plug in: the notable patterns panel (#331) between the per-Commission
 * table and the narrative; the Draft narrative menu (#341) in the narrative's header with its
 * errors above the sections; AI labels and figure citations under each paragraph.
 */
export interface NcrExtensions {
  patterns?: (context: NcrExtensionContext) => ReactNode;
  narrativeActions?: (context: NcrExtensionContext) => ReactNode;
  narrativeNotice?: (context: NcrExtensionContext) => ReactNode;
  paragraphMeta?: (paragraph: NarrativeParagraph, context: NcrExtensionContext) => ReactNode;
}

export interface NationalReportViewProps {
  fy: number;
  /** The years to choose from, latest first. */
  years: number[];
  onYearChange: (fy: number) => void;
  /** The page of the per-Commission table. */
  page: number;
  onPageChange: (page: number) => void;
  /** The year's report and how many have reported; null while it loads. */
  result: NationalReportResult<NationalReportPage> | null;
  viewer: NcrViewer & { name: string };
  build: (fy: number) => Promise<NationalReportResult<NationalReport>>;
  saveNarrative: (
    fy: number,
    narrative: Narrative,
  ) => Promise<NationalReportResult<NationalReport>>;
  approve: ApproveReport;
  pdfLink: (documentId: string) => Promise<ServiceResult<NationalReportPdf>>;
  onUnauthenticated: () => void;
  /** Offered to staff refused the page (403). */
  forbiddenAction?: ReactNode;
  extensions?: NcrExtensions;
}

/** How often, and how many times, to look for the PDF the approval workflow issues. */
const PDF_POLL_MS = 2_000;
const PDF_POLLS = 15;

const NARRATIVE_SECTIONS: NarrativeSection[] = [
  { id: 'overview', label: m.sections.overview, maxLength: 20_000 },
  { id: 'findings', label: m.sections.findings, maxLength: 40_000 },
  { id: 'recommendations', label: m.sections.recommendations, maxLength: 20_000 },
];

/**
 * EACC's national consolidated report for a financial year (spec 09 FE-4, S11 and S15): built by
 * an EACC analyst from the Commissions' submitted reports (national totals per Form M section, a
 * row per Commission, rates), with a narrative they write (Overview, Findings, Recommendations,
 * autosaved), approved by an EACC supervisor who did not write it, then frozen with its NCR
 * reference and Restricted PDF. States: loading, no reports yet, not built, building, draft
 * (stale when reports arrived since the build), approved, error.
 */
export function NationalReportView(props: NationalReportViewProps) {
  const { result, fy } = props;
  if (problemStatus(result) === 403) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <NoAccess text={m.noAccess} action={props.forbiddenAction} />
      </Page>
    );
  }
  return (
    <Page>
      <PageHead title={m.title} actions={<YearSelect {...props} />} />
      {result === null ? (
        <Loading />
      ) : !result.ok ? (
        <LoadError
          title={m.loadErrorTitle}
          detail={
            result.error.kind === 'unavailable' && result.error.detail
              ? result.error.detail
              : m.loadErrorDetail
          }
          retryLabel={m.tryAgain}
        />
      ) : (
        <Loaded {...props} key={fy} data={result.data} />
      )}
    </Page>
  );
}

function YearSelect({ fy, years, onYearChange }: NationalReportViewProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-2.5">
      <label htmlFor={id} className="text-[13.5px] text-muted-foreground">
        {m.yearLabel}
      </label>
      <Select
        id={id}
        value={String(fy)}
        onValueChange={(value) => {
          onYearChange(Number(value));
        }}
        className="h-10 w-auto min-w-[260px]"
      >
        {years.map((year) => (
          <SelectItem key={year} value={String(year)}>
            {m.yearOption(fyLabel(year), formatDate(dueDateOf(year)))}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-[84px] w-full rounded-2xl" />
      <Skeleton className="h-[260px] w-full rounded-2xl" />
      <Skeleton className="h-[360px] w-full rounded-2xl" />
    </div>
  );
}

function Loaded(props: NationalReportViewProps & { data: NationalReportPage }) {
  const { data, viewer, fy, build, onUnauthenticated } = props;
  const router = useRouter();
  const { toast } = useToast();
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const isAnalyst = viewer.roles.includes(EACC_ANALYST);

  const runBuild = async () => {
    setBuilding(true);
    setBuildError(null);
    const result = await build(fy);
    if (result.ok) {
      toast({ title: m.built(result.data.reportsIncluded) });
      await router.invalidate();
    } else if (result.error.kind === 'unauthenticated') {
      onUnauthenticated();
    } else if (result.error.kind === 'problem' && result.error.problem.status === 409) {
      setBuildError(
        result.error.problem.code === 'no-submitted-reports' ? m.noSubmittedReports : m.buildFailed,
      );
      await router.invalidate();
    } else {
      setBuildError(m.buildFailed);
    }
    setBuilding(false);
  };

  const error = buildError ? (
    <Alert variant="destructive" className="mb-4">
      <Icon icon={AlertCircleIcon} />
      <AlertDescription>{buildError}</AlertDescription>
    </Alert>
  ) : null;

  if (building) {
    return (
      <Card className="p-0 sm:p-0">
        <div role="status" className="flex flex-col items-center px-5 py-12 text-center">
          <Spinner className="mb-3.5 size-7" />
          <h3 className="text-[15px] font-semibold">{m.building(data.reported)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{m.buildingText}</p>
        </div>
      </Card>
    );
  }

  if (!data.report) {
    return (
      <>
        {error}
        <Card className="p-0 sm:p-0">
          {data.reported === 0 ? (
            <EmptyState
              icon={<Icon icon={InboxIcon} />}
              title={m.noReportsTitle(fyLabel(fy))}
              description={m.noReportsText(formatDate(dueDateOf(fy)))}
            />
          ) : (
            <EmptyState
              icon={<Icon icon={File01Icon} />}
              title={m.notBuiltTitle}
              description={m.notBuiltText(data.reported, data.notReported)}
              action={
                isAnalyst ? (
                  <Button
                    onClick={() => {
                      void runBuild();
                    }}
                  >
                    <Icon icon={RefreshIcon} />
                    {m.build(data.reported)}
                  </Button>
                ) : undefined
              }
            />
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      {error}
      <Built
        {...props}
        report={data.report}
        newReports={newReportsSince({ reported: data.reported, report: data.report })}
        isAnalyst={isAnalyst}
        onRebuild={() => {
          void runBuild();
        }}
      />
    </>
  );
}

function Built({
  report,
  newReports,
  isAnalyst,
  onRebuild,
  ...props
}: NationalReportViewProps & {
  report: NationalReport;
  newReports: number;
  isAnalyst: boolean;
  onRebuild: () => void;
}) {
  const approved = report.status === 'approved';
  const context: NcrExtensionContext = { report, canEdit: !approved && isAnalyst };
  return (
    <div className="flex flex-col gap-4">
      <StatusBar {...props} report={report} isAnalyst={isAnalyst} onRebuild={onRebuild} />
      {newReports > 0 ? (
        <Alert variant="warning" className="items-center">
          <Icon icon={InformationCircleIcon} />
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              <b className="font-semibold">{m.newReports(newReports)}</b> {m.newReportsText}
            </span>
            {isAnalyst ? (
              <Button variant="secondary" size="sm" className="ml-auto" onClick={onRebuild}>
                {m.rebuild}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <NationalTotals aggregates={report.aggregates} />
      <CommissionsTable
        aggregates={report.aggregates}
        page={props.page}
        onPageChange={props.onPageChange}
      />
      {props.extensions?.patterns?.(context)}
      <NarrativeCard
        // A fresh editor for another report or once approved; edits survive reloads otherwise.
        key={`${report.id}:${report.status}`}
        {...props}
        report={report}
        context={context}
      />
    </div>
  );
}

const NCR_PARTS: readonly ReferencePart[] = [
  { label: 'Type', meaning: 'National consolidated report' },
  { label: 'Issuer', meaning: 'Ethics and Anti-Corruption Commission' },
  { label: 'Year', meaning: 'End of the financial year reported on' },
  { label: 'Sequence', meaning: 'Number within that year' },
  { label: 'Check', meaning: 'Catches typing mistakes' },
];

function StatusBar({
  report,
  isAnalyst,
  onRebuild,
  viewer,
  fy,
  approve,
  pdfLink,
  onUnauthenticated,
}: NationalReportViewProps & {
  report: NationalReport;
  isAnalyst: boolean;
  onRebuild: () => void;
}) {
  const [approving, setApproving] = useState(false);
  const approval = approvalOf(report, viewer);
  const approved = approval === 'approved';
  const meta = [
    report.builtAt ? formatDateTime(report.builtAt) : null,
    report.author ? m.author(report.author.name) : null,
    approved && report.approver && report.approvedAt
      ? m.approvedBy(report.approver.name, formatDateTime(report.approvedAt))
      : null,
  ].filter(Boolean);
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-5 sm:py-4">
      {approved ? (
        <Badge variant="success" className="pl-[7px]">
          <Icon icon={Tick02Icon} strokeWidth={2.4} />
          {m.approved}
        </Badge>
      ) : (
        <Badge className="pl-[7px]">
          <Icon icon={PencilEdit02Icon} />
          {m.draft}
        </Badge>
      )}
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
          {m.builtFrom(report.reportsIncluded)}
        </h2>
        <p className="mt-0.5 text-[13.5px] text-muted-foreground">{meta.join(' · ')}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2.5">
        {approved ? (
          <>
            {report.reference ? (
              <ReferenceChip reference={report.reference} parts={NCR_PARTS} />
            ) : null}
            <PdfButton report={report} pdfLink={pdfLink} onUnauthenticated={onUnauthenticated} />
          </>
        ) : (
          <>
            {isAnalyst ? (
              <Button variant="secondary" onClick={onRebuild}>
                <Icon icon={RefreshIcon} />
                {m.rebuild}
              </Button>
            ) : null}
            {approval === 'can-approve' ? null : (
              <span className="text-[13.5px] text-muted-foreground">
                {approval === 'author' ? m.authorCannotApprove : m.onlySupervisorApproves}
              </span>
            )}
            <Button
              disabled={approval !== 'can-approve'}
              onClick={() => {
                setApproving(true);
              }}
            >
              <Icon icon={Stamp01Icon} />
              {m.approve}
            </Button>
          </>
        )}
      </div>
      {approving ? (
        <ApproveDialog
          open
          onOpenChange={setApproving}
          fy={fy}
          author={report.author?.name ?? ''}
          approver={viewer.name}
          approve={approve}
          onUnauthenticated={onUnauthenticated}
        />
      ) : null}
    </Card>
  );
}

/** Downloads the Restricted PDF, or says it is being prepared until the workflow issues it. */
function PdfButton({
  report,
  pdfLink,
  onUnauthenticated,
}: {
  report: NationalReport;
  pdfLink: NationalReportViewProps['pdfLink'];
  onUnauthenticated: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  usePollWhile(report.documentId === null, PDF_POLL_MS, PDF_POLLS);
  const documentId = report.documentId;
  if (!documentId) {
    return (
      <Button disabled aria-busy="true">
        <Spinner className="size-4" />
        {m.preparingPdf}
      </Button>
    );
  }
  return (
    <Button
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => {
        setBusy(true);
        void pdfLink(documentId).then((result) => {
          setBusy(false);
          if (result.ok) downloadFrom(result.data.downloadUrl);
          else if (result.error.kind === 'unauthenticated') onUnauthenticated();
          else toast({ title: m.pdfFailed, urgency: 'assertive' });
        });
      }}
    >
      {busy ? <Spinner className="size-4" /> : <Icon icon={Download04Icon} />}
      {m.downloadPdf}
    </Button>
  );
}

function NarrativeCard({
  report,
  context,
  fy,
  saveNarrative,
  onUnauthenticated,
  extensions,
}: NationalReportViewProps & { report: NationalReport; context: NcrExtensionContext }) {
  const router = useRouter();
  const [value, setValue] = useState<NarrativeEditorValue>(() =>
    editorValueOf(report.narrativeParagraphs),
  );
  const autosave = useAutosave<Narrative>(async (narrative) => {
    const result = await saveNarrative(fy, narrative);
    if (result.ok) return;
    const { error } = result;
    if (error.kind === 'unauthenticated') {
      onUnauthenticated();
      throw new AutosaveFailure('error');
    }
    if (error.kind === 'problem') {
      // Approved meanwhile (409): the page shows it frozen once reloaded.
      if (error.problem.status === 409) void router.invalidate();
      throw new AutosaveFailure('error', error.problem.detail);
    }
    throw new Error('The narrative could not be saved');
  });
  const approved = report.status === 'approved';
  return (
    <NarrativeEditor<NarrativeParagraph>
      id="ncr-narrative"
      sections={NARRATIVE_SECTIONS}
      value={value}
      readOnly={!context.canEdit}
      readOnlyNote={approved ? m.frozenAtApproval : m.writtenByAnalyst}
      autosave={context.canEdit ? autosave : undefined}
      onChange={(next, change) => {
        setValue(next);
        if (change.textChanged) autosave.change(narrativeTextOf(next));
      }}
      createParagraph={(id, section) => ({
        id,
        section: sectionId(section.id),
        position: 0,
        text: '',
        aiDraft: false,
        aggregateRefs: [],
        candidateIds: [],
      })}
      actions={extensions?.narrativeActions?.(context)}
      notice={extensions?.narrativeNotice?.(context)}
      paragraphMeta={
        extensions?.paragraphMeta
          ? (paragraph) => extensions.paragraphMeta?.(paragraph, context)
          : undefined
      }
      title={m.narrativeTitle}
    />
  );
}

function sectionId(id: string): NarrativeParagraph['section'] {
  return NARRATIVE_SECTION_IDS.find((each) => each === id) ?? 'overview';
}
