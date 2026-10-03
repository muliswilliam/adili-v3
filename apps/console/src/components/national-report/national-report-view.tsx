import {
  AiLabel,
  Alert,
  AlertDescription,
  type Autosave,
  AutosaveFailure,
  Badge,
  Button,
  Card,
  EmptyState,
  formatDate,
  formatDateTime,
  Icon,
  NATIONAL_REPORT_NARRATIVE_SECTIONS,
  NarrativeEditor,
  ReferenceChip,
  type ReferencePart,
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
import { type ReactNode, useState } from 'react';

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
import { YearSelect } from '../eacc-intake/year-select';
import { dueDateOf } from '../form-m/financial-year';
import { usePollWhile } from '../use-poll-while';
import { CommissionsTable, NationalTotals } from './aggregate-tables';
import { type ApproveReport, ApproveDialog } from './approve-dialog';
import { messages as intakeMessages } from '../eacc-intake/messages';
import { messages as m } from './messages';
import {
  approvalOf,
  editorValueOf,
  type NarrativeEditorValue,
  narrativeTextOf,
  type NcrViewer,
  newReportsSince,
} from './model';

/**
 * What spec 09b's panels get from the page. They read the report and the narrative being edited,
 * and change the narrative through the page, so every change is shown in the editor and saved
 * through its autosave like typing.
 */
export interface NcrExtensionContext {
  /** The report as last read from the reporting service. */
  report: NationalReport;
  /** The viewer writes the narrative (an EACC analyst, while the report is a draft). */
  canEdit: boolean;
  /** The narrative being edited: each section's paragraphs, unsaved edits included. */
  narrative: NarrativeEditorValue;
  /**
   * Changes the narrative being edited and saves it, e.g. #331's "Cite in findings" with
   * `appendParagraph(value, 'findings', { text, aggregateRefs, candidateIds })`. Ignored unless
   * `canEdit`.
   *
   * Today a saved paragraph keeps only its text: `PATCH .../narrative` takes each section as text,
   * so a new paragraph's `aggregateRefs` and `candidateIds` are dropped by the service (#500). Pass
   * them anyway; they show until the next reload and survive once the contract carries them.
   */
  editNarrative: (edit: (value: NarrativeEditorValue) => NarrativeEditorValue) => void;
  /**
   * Takes a report the service answered with (#341's draft endpoint inserting or replacing AI-draft
   * paragraphs) as the narrative being edited, dropping edits not saved yet, and reloads the page.
   */
  adoptReport: (report: NationalReport) => void;
}

/**
 * Where spec 09b's panels plug in (#331, #341):
 * - `patterns`: the notable patterns panel (#331), between the per-Commission table and the
 *   narrative.
 * - `narrativeActions`: the Draft narrative menu (#341) in the narrative's header.
 * - `narrativeNotice`: above the sections, e.g. #341's drafting errors.
 * - `paragraphMeta`: under each paragraph after the "AI draft" label the page always shows on an
 *   AI-drafted paragraph, e.g. #341's figure citation chips (do not render another AI label).
 */
export interface NcrExtensions {
  patterns?: (context: NcrExtensionContext) => ReactNode;
  narrativeActions?: (context: NcrExtensionContext) => ReactNode;
  narrativeNotice?: (context: NcrExtensionContext) => ReactNode;
  paragraphMeta?: (paragraph: NarrativeParagraph, context: NcrExtensionContext) => ReactNode;
}

export interface NationalReportViewProps {
  fy: number;
  /** Today in Nairobi, which the year selector counts from; null while the page loads. */
  today: string | null;
  onYearChange: (fy: number) => void;
  /** The workspace's tabs under the title (intake, national report). */
  tabs?: ReactNode;
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
        <PageHead title={m.workspaceTitle} />
        <NoAccess text={m.noAccess} action={props.forbiddenAction} />
      </Page>
    );
  }
  return (
    <Page>
      <PageHead
        title={m.workspaceTitle}
        actions={
          props.today ? (
            <YearSelect today={props.today} fy={fy} onChange={props.onYearChange} />
          ) : (
            <Skeleton className="h-10 w-64" />
          )
        }
      />
      {props.tabs}
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
      // Approved meanwhile (`ncr-approved`): the reloaded page shows it, nothing failed.
      if (result.error.problem.code === 'no-submitted-reports') setBuildError(m.noSubmittedReports);
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

  // A first build has nothing to show yet; a rebuild keeps the report (and the narrative being
  // typed, whose waiting save would otherwise race the build) on the page.
  if (building && !data.report) {
    return (
      <Card className="p-0 sm:p-0">
        <div role="status" className="flex flex-col items-center px-5 py-12 text-center">
          <Spinner className="mb-3.5 size-7" />
          <h3 className="text-[15px] font-semibold">{m.building(data.reported)}</h3>
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
              title={m.noReportsTitle(intakeMessages.fyLabel(fy))}
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
        rebuilding={building}
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
  rebuilding,
  onRebuild,
  ...props
}: NationalReportViewProps & {
  report: NationalReport;
  newReports: number;
  isAnalyst: boolean;
  rebuilding: boolean;
  onRebuild: () => void;
}) {
  const approved = report.status === 'approved';
  const canEdit = !approved && isAnalyst;
  const draft = useNarrativeDraft({ ...props, report, canEdit });
  const context: NcrExtensionContext = {
    report,
    canEdit,
    narrative: draft.value,
    editNarrative: draft.edit,
    adoptReport: draft.adopt,
  };
  return (
    <div className="flex flex-col gap-4">
      <StatusBar
        {...props}
        report={report}
        isAnalyst={isAnalyst}
        rebuilding={rebuilding}
        onRebuild={onRebuild}
      />
      {newReports > 0 ? (
        <Alert
          variant="warning"
          role="status"
          className="py-2.5 [&>svg]:top-1/2 [&>svg]:-translate-y-1/2"
        >
          <Icon icon={InformationCircleIcon} />
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              <b className="font-semibold">{m.newReports(newReports)}</b> {m.newReportsText}
            </span>
            {isAnalyst ? (
              <RebuildButton
                size="sm"
                className="ml-auto"
                rebuilding={rebuilding}
                onRebuild={onRebuild}
              />
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
      <NarrativeCard {...props} report={report} context={context} draft={draft} />
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

function RebuildButton({
  rebuilding,
  onRebuild,
  size,
  className,
}: {
  rebuilding: boolean;
  onRebuild: () => void;
  size?: 'sm';
  className?: string;
}) {
  return (
    <Button
      variant="secondary"
      size={size}
      className={className}
      disabled={rebuilding}
      aria-busy={rebuilding || undefined}
      onClick={onRebuild}
    >
      {rebuilding ? <Spinner className="size-4" /> : size ? null : <Icon icon={RefreshIcon} />}
      {rebuilding ? m.rebuilding : m.rebuild}
    </Button>
  );
}

function StatusBar({
  report,
  isAnalyst,
  rebuilding,
  onRebuild,
  viewer,
  fy,
  approve,
  pdfLink,
  onUnauthenticated,
}: NationalReportViewProps & {
  report: NationalReport;
  isAnalyst: boolean;
  rebuilding: boolean;
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
    <Card className="flex-row flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-5 sm:py-4">
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
            {isAnalyst ? <RebuildButton rebuilding={rebuilding} onRebuild={onRebuild} /> : null}
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
          author={report.author?.name ?? m.unknownOfficer}
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
  const poll = usePollWhile(report.documentId === null, PDF_POLL_MS, PDF_POLLS);
  const documentId = report.documentId;
  if (!documentId && poll.exhausted) {
    return (
      <span className="flex items-center gap-2.5">
        <span className="text-[13.5px] text-muted-foreground">{m.pdfSlow}</span>
        <Button variant="secondary" onClick={poll.restart}>
          <Icon icon={RefreshIcon} />
          {m.checkAgain}
        </Button>
      </span>
    );
  }
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

interface NarrativeDraft {
  value: NarrativeEditorValue;
  autosave: Autosave<Narrative>;
  /** An edit typed in the editor. */
  change: (next: NarrativeEditorValue, textChanged: boolean) => void;
  edit: NcrExtensionContext['editNarrative'];
  adopt: NcrExtensionContext['adoptReport'];
}

/**
 * The narrative being edited, kept above the editor so a rebuild leaves it be. It is saved through
 * one `useAutosave`. When the report changes on the server (another version than the editor took,
 * not one of its own saves: a rebuild, an approval, another analyst's edit) the editor takes the
 * server's narrative, unless edits are not saved yet (waiting, retrying or refused), which then
 * win.
 */
function useNarrativeDraft({
  report,
  canEdit,
  fy,
  saveNarrative,
  onUnauthenticated,
}: NationalReportViewProps & { report: NationalReport; canEdit: boolean }): NarrativeDraft {
  const router = useRouter();
  const [value, setValue] = useState<NarrativeEditorValue>(() =>
    editorValueOf(report.narrativeParagraphs),
  );
  const [basis, setBasis] = useState({ id: report.id, version: report.version });
  // Versions the editor already holds: its own saves and the reports it adopted.
  const [own, setOwn] = useState<ReadonlySet<number>>(() => new Set());
  const hold = (version: number) => {
    setOwn((held) => new Set(held).add(version));
  };
  const autosave = useAutosave<Narrative>(async (narrative) => {
    const result = await saveNarrative(fy, narrative);
    if (result.ok) {
      hold(result.data.version);
      return;
    }
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
  if (report.id !== basis.id || report.version !== basis.version) {
    setBasis({ id: report.id, version: report.version });
    // Edits not saved yet win: waiting, being retried, or refused (still on screen, unsaved).
    const waiting =
      autosave.status === 'saving' || autosave.status === 'retrying' || autosave.status === 'error';
    if (report.id !== basis.id || (!own.has(report.version) && !waiting)) {
      setValue(editorValueOf(report.narrativeParagraphs));
    }
  }
  return {
    value,
    autosave,
    change: (next, textChanged) => {
      setValue(next);
      if (textChanged) autosave.change(narrativeTextOf(next));
    },
    edit: (edit) => {
      if (!canEdit) return;
      const next = edit(value);
      setValue(next);
      autosave.change(narrativeTextOf(next));
    },
    adopt: (adopted) => {
      hold(adopted.version);
      autosave.reset();
      setValue(editorValueOf(adopted.narrativeParagraphs));
      void router.invalidate();
    },
  };
}

function NarrativeCard({
  report,
  context,
  draft,
  extensions,
}: NationalReportViewProps & {
  report: NationalReport;
  context: NcrExtensionContext;
  draft: NarrativeDraft;
}) {
  const approved = report.status === 'approved';
  return (
    <NarrativeEditor<NarrativeParagraph>
      id="ncr-narrative"
      sections={NATIONAL_REPORT_NARRATIVE_SECTIONS}
      value={draft.value}
      readOnly={!context.canEdit}
      readOnlyNote={approved ? m.frozenAtApproval : m.writtenByAnalyst}
      autosave={context.canEdit ? draft.autosave : undefined}
      onChange={(next, change) => {
        draft.change(next, change.textChanged);
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
      paragraphMeta={(paragraph) => {
        const extra = extensions?.paragraphMeta?.(paragraph, context);
        return paragraph.aiDraft || extra ? (
          <>
            {paragraph.aiDraft ? <AiLabel size="sm" text={m.aiDraft} /> : null}
            {extra}
          </>
        ) : null;
      }}
      title={m.narrativeTitle}
    />
  );
}

function sectionId(id: string): NarrativeParagraph['section'] {
  const found = NARRATIVE_SECTION_IDS.find((each) => each === id);
  if (!found) throw new Error(`Unknown narrative section ${id}`);
  return found;
}
