import type { FormMV1 } from '@adili/forms';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  focusRing,
  type FormMDeclarationSectionKey,
  type FormMSectionProps,
  formatDate,
  formatDateTime,
  Icon,
  type IconProps,
  Skeleton,
  Spinner,
  type Tone,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Calendar03Icon,
  Notification03Icon,
  PencilEdit02Icon,
  RefreshIcon,
  Tick02Icon,
  UserCheck01Icon,
  ViewIcon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';

import type { FormMResult, FormMWorkspace } from '../../server/form-m.server';
import type { ComplianceReport, ReportPeriod } from '../../server/reporting/types';
import { Page, PageHead } from '../page';
import { usePollWhile } from '../use-poll-while';
import {
  AccessSection,
  ClarificationsSection,
  ComplaintsCard,
  DeclarationSections,
  FORM_M_ANCHORS,
  PartHeading,
  PartICard,
  PartIIICard,
} from './form-m-document';
import {
  daysToDue,
  dueLine,
  manualMissing,
  periodLine,
  reviewedOn,
  type SignOffStep,
  signOffSteps,
  yearEnded,
} from './form-m-view';
import type { FormMCapabilities } from './capabilities';
import { finalCompileOf, financialYearOf, previewFromOf, yearEndOf } from './financial-year';
import { messages as m } from './messages';

/** How often, and how many times, the page reloads while the report compiles (seconds). */
const COMPILE_POLL_MS = 2000;
const COMPILE_POLLS = 30;

/** A report with its document, as the draft view renders it. */
export type CompiledReport = ComplianceReport & { document: FormMV1 };

/**
 * Where the sign-off screens (#226) plug into the draft view, each given the report as it stands:
 * the footer's action, editable remarks, and the editable Part I and Part B. Without them the
 * draft reads as it does for the reporting officer.
 */
export interface FormMReportExtensions {
  /**
   * The step's action in the footer: Mark reviewed, Confirm and submit. Told whether the report
   * is a preview, so the sign-off screens decide what a preview allows. Return null for no
   * action: the footer then shows its own note; with an action it leaves the note out. Not asked
   * for a submitted report, which has no footer.
   */
  footerActions?: (report: CompiledReport, context: { preview: boolean }) => ReactNode;
  /** Extra props per section 1-3, e.g. `onRemarkChange` and `autosave` for the supervisor. */
  sectionProps?: (
    section: FormMDeclarationSectionKey,
    report: CompiledReport,
  ) => Partial<FormMSectionProps>;
  /** Replaces the read-only Part I, e.g. the commission-admin's contact fields. */
  partI?: (report: CompiledReport) => ReactNode;
  /** Replaces the read-only Part B, e.g. the commission-admin's complaints entry. */
  complaints?: (report: CompiledReport) => ReactNode;
  /**
   * Says why the footer has no action for the viewer, e.g. "Awaiting supervisor review": a
   * string, null for nothing, undefined for the default ("Read only" for the reporting officer).
   * Previews keep theirs.
   */
  footerNote?: (report: CompiledReport) => string | null | undefined;
  /** Banners over the report, above the due date's, e.g. a confirmation that did not go through. */
  banners?: (report: CompiledReport) => ReactNode;
  /** Replaces a submitted report's header, e.g. with the reference, receipt and downloads. */
  submitted?: (report: CompiledReport) => ReactNode;
}

export interface FormMWorkspaceViewProps {
  /** The workspace; null while it loads. */
  result: FormMResult<FormMWorkspace> | null;
  /** What the viewer may do (`formMCapabilities`, from the route): the supervisor compiles. */
  capabilities: FormMCapabilities;
  onSelect: (fy: number) => void;
  /** Compiles a preview or recompiles the year's draft (the supervisor). */
  onCompile: (fy: number) => Promise<FormMResult<null>>;
  extensions?: FormMReportExtensions;
}

/**
 * A Commission's Form M workspace (spec 09 FE-2, #223): the financial years with each report's
 * status, and the selected year as no draft yet, a preview to compile, compiling, or the draft
 * with every part of the form, its sign-off steps and the due date. The supervisor compiles and
 * recompiles; the commission-admin and the reporting officer read. Remarks, Part I and Part B
 * entry, review and confirmation build on it (#226).
 */
export function FormMWorkspaceView({
  result,
  capabilities,
  onSelect,
  onCompile,
  extensions = {},
}: FormMWorkspaceViewProps) {
  return (
    <Page className="@container">
      <PageHead title={m.title} />
      {result === null ? (
        <WorkspaceLoading />
      ) : result.ok ? (
        // Keyed by year: a compile in flight or a refusal belongs to the year it was for.
        <Workspace
          key={result.data.fy}
          data={result.data}
          capabilities={capabilities}
          onSelect={onSelect}
          onCompile={onCompile}
          extensions={extensions}
        />
      ) : (
        <WorkspaceLoadError />
      )}
    </Page>
  );
}

function WorkspaceLoading() {
  return (
    <div aria-busy="true" aria-label={m.loading} className="grid gap-4">
      <div className="grid gap-2.5 @min-[700px]:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
        {[0, 1].map((key) => (
          <Card key={key} className="grid gap-3 px-4 py-[15px] sm:px-4 sm:py-[15px]">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="w-4/5" />
          </Card>
        ))}
      </div>
      <Card className="grid gap-4">
        {['w-[70%]', 'w-[40%]', 'w-[90%]', 'w-[60%]', 'w-[80%]'].map((width) => (
          <Skeleton key={width} className={width} />
        ))}
      </Card>
    </div>
  );
}

function WorkspaceLoadError() {
  const router = useRouter();
  return (
    <Card className="p-0 sm:p-0">
      <EmptyState
        className="py-12"
        tone="destructive"
        icon={<Icon icon={WifiDisconnected01Icon} />}
        title={m.loadErrorTitle}
        description={m.loadErrorDetail}
        action={
          <Button variant="secondary" onClick={() => void router.invalidate()}>
            <Icon icon={RefreshIcon} />
            {m.tryAgain}
          </Button>
        }
      />
    </Card>
  );
}

function Workspace({
  data,
  capabilities,
  onSelect,
  onCompile,
  extensions,
}: {
  data: FormMWorkspace;
  capabilities: FormMCapabilities;
  onSelect: (fy: number) => void;
  onCompile: (fy: number) => Promise<FormMResult<null>>;
  extensions: FormMReportExtensions;
}) {
  const router = useRouter();
  const { periods, fy, report, today } = data;
  const period = periods.find((candidate) => candidate.fy === fy);
  const [compiling, setCompiling] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const compile = async () => {
    setCompiling(true);
    setRefusal(null);
    const outcome = await onCompile(fy);
    if (outcome.ok) {
      await router.invalidate();
    } else {
      setRefusal(refusalOf(outcome, fy));
    }
    setCompiling(false);
  };

  const preview = report?.preview ?? false;

  return (
    <div className="grid gap-4">
      <PeriodPicker
        periods={periods}
        selected={fy}
        selectedPreview={preview}
        today={today}
        onSelect={(next) => {
          setRefusal(null);
          onSelect(next);
        }}
      />
      {refusal ? (
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      ) : null}
      {report === null || period === undefined ? (
        <NotStarted
          fy={fy}
          today={today}
          previewAvailable={period?.previewAvailable ?? false}
          compiles={capabilities.compilesAndReviews}
          compiling={compiling}
          onCompile={() => void compile()}
        />
      ) : report.status === 'compiling' ? (
        <Compiling />
      ) : (
        <ReportView
          report={report}
          today={today}
          preview={preview}
          capabilities={capabilities}
          extensions={extensions}
          recompile={
            capabilities.compilesAndReviews && report.status !== 'submitted' ? (
              <Button variant="secondary" disabled={compiling} onClick={() => void compile()}>
                {compiling ? <Spinner className="size-4" /> : <Icon icon={RefreshIcon} />}
                {m.recompile}
              </Button>
            ) : null
          }
        />
      )}
    </div>
  );
}

function refusalOf(outcome: Extract<FormMResult<null>, { ok: false }>, fy: number): string {
  if (outcome.error.kind !== 'problem') return m.compileFailed;
  const { code } = outcome.error.problem;
  if (code === 'preview-not-available') return m.previewNotAvailable(formatDate(previewFromOf(fy)));
  if (code === 'report-submitted') return m.reportSubmitted;
  return outcome.error.problem.detail ?? m.compileFailed;
}

interface StatusBadge {
  label: string;
  tone: Tone;
  icon?: IconProps['icon'];
}

function statusBadge(period: ReportPeriod, preview: boolean): StatusBadge {
  switch (period.status) {
    case 'not-started':
      return { label: m.status['not-started'], tone: 'default' };
    case 'compiling':
      return { label: m.status.compiling, tone: 'default', icon: RefreshIcon };
    case 'draft':
      return preview
        ? { label: m.preview, tone: 'default', icon: ViewIcon }
        : { label: m.status.draft, tone: 'default', icon: PencilEdit02Icon };
    case 'reviewed':
      return { label: m.status.reviewed, tone: 'info', icon: UserCheck01Icon };
    case 'submitted':
      return period.late
        ? { label: m.submittedLate, tone: 'warning', icon: Tick02Icon }
        : { label: m.status.submitted, tone: 'success', icon: Tick02Icon };
  }
}

/** The financial years as cards: the year, Current, the report's status and its line. */
function PeriodPicker({
  periods,
  selected,
  selectedPreview,
  today,
  onSelect,
}: {
  periods: readonly ReportPeriod[];
  selected: number;
  /** The selected year's report is a preview (the summary does not say). */
  selectedPreview: boolean;
  today: string;
  onSelect: (fy: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label={m.periods}
      className="grid gap-2.5 @min-[700px]:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
    >
      {periods.map((period) => {
        const on = period.fy === selected;
        const badge = statusBadge(period, on && selectedPreview);
        return (
          <button
            key={period.fy}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onSelect(period.fy);
            }}
            className={cn(
              focusRing,
              'flex flex-col items-start gap-1.5 rounded-xl bg-card px-4 py-[15px] text-left shadow-card transition-shadow hover:shadow-card-hover',
              on && 'ring-[1.5px] ring-foreground',
            )}
          >
            <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
              {m.fyLabel(period.fy)}
              {period.fy === financialYearOf(today) ? (
                <Badge variant="brand">{m.current}</Badge>
              ) : null}
              <Badge variant={badge.tone}>
                {badge.icon ? <Icon icon={badge.icon} /> : null}
                {badge.label}
              </Badge>
            </span>
            <span className="text-[13px] text-muted-foreground">{periodLine(period, today)}</span>
          </button>
        );
      })}
    </div>
  );
}

function NotStarted({
  fy,
  today,
  previewAvailable,
  compiles,
  compiling,
  onCompile,
}: {
  fy: number;
  today: string;
  previewAvailable: boolean;
  compiles: boolean;
  compiling: boolean;
  onCompile: () => void;
}) {
  const year = m.fyLabel(fy);
  const compileButton = (label: string) => (
    <Button disabled={compiling} onClick={onCompile}>
      {compiling ? <Spinner className="size-4" /> : <Icon icon={RefreshIcon} />}
      {label}
    </Button>
  );
  if (yearEnded(fy, today)) {
    // The year is over and no draft was compiled (a Commission onboarded after 1 July, or the
    // schedule did not run): compiling now makes the final draft, not a preview.
    return (
      <Card className="p-0 sm:p-0">
        <EmptyState
          icon={<Icon icon={Calendar03Icon} />}
          title={m.pastYearTitle(year)}
          description={m.pastYearText}
          action={
            compiles ? (
              compileButton(m.compileDraft)
            ) : (
              <p className="text-sm text-muted-foreground">{m.supervisorCompilesDraft}</p>
            )
          }
        />
      </Card>
    );
  }
  return (
    <Card className="p-0 sm:p-0">
      {previewAvailable ? (
        <EmptyState
          icon={<Icon icon={ViewIcon} />}
          title={m.previewTitle(year)}
          description={m.previewText}
          action={
            compiles ? (
              compileButton(m.compilePreview)
            ) : (
              <p className="text-sm text-muted-foreground">{m.supervisorCompiles}</p>
            )
          }
        />
      ) : (
        <EmptyState
          icon={<Icon icon={Calendar03Icon} />}
          title={m.noDraftTitle}
          description={m.noDraft(year)}
        />
      )}
    </Card>
  );
}

/** The report compiles: say so, and reload until it leaves `compiling`. */
function Compiling() {
  const poll = usePollWhile(true, COMPILE_POLL_MS, COMPILE_POLLS);
  return (
    <Card className="p-0 sm:p-0">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center px-5 py-12 text-center"
      >
        <Spinner className="mb-3.5 size-7 text-foreground" />
        <h3 className="text-[15px] leading-snug font-semibold">{m.compiling}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {poll.exhausted ? m.compilingSlow : m.compilingDetail}
        </p>
        {poll.exhausted ? (
          <Button variant="secondary" size="sm" className="mt-3.5" onClick={poll.restart}>
            <Icon icon={RefreshIcon} />
            {m.checkAgain}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** Banners over the draft: a preview, or the due date near or passed (reminders mirror them). */
function Banners({
  report,
  today,
  preview,
}: {
  report: ComplianceReport;
  today: string;
  preview: boolean;
}) {
  if (preview) {
    return (
      <Alert role="status">
        <Icon icon={ViewIcon} />
        <AlertDescription>
          <b className="font-semibold">{m.previewBanner}</b>{' '}
          {m.previewBannerDetail(formatDate(finalCompileOf(report.fy)))}
        </AlertDescription>
      </Alert>
    );
  }
  if (report.status !== 'draft' && report.status !== 'reviewed') return null;
  const days = daysToDue(report.dueDate, today);
  if (days < 0) {
    return (
      <Alert variant="destructive">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>
          <b className="font-semibold">{m.overdueBanner(-days)}</b> {m.overdueBannerDetail}
        </AlertDescription>
      </Alert>
    );
  }
  if (days <= 14) {
    return (
      <Alert variant="warning">
        <Icon icon={Notification03Icon} />
        <AlertDescription>
          <b className="font-semibold">{days === 0 ? m.dueTodayBanner : m.dueSoonBanner(days)}</b>{' '}
          {m.dueSoonDetail(formatDate(report.dueDate))}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

/** The draft (or a submitted report) with the sign-off panel and the footer. */
function ReportView({
  report: answered,
  today,
  preview,
  capabilities,
  extensions,
  recompile,
}: {
  report: ComplianceReport;
  today: string;
  preview: boolean;
  capabilities: FormMCapabilities;
  extensions: FormMReportExtensions;
  recompile: ReactNode;
}) {
  const document = answered.document;
  if (!document) return <Compiling />;
  const report: CompiledReport = { ...answered, document };
  const missing = manualMissing(document);
  const submitted = report.status === 'submitted';
  const actions = submitted ? null : (extensions.footerActions?.(report, { preview }) ?? null);
  const submittedHeader = submitted ? extensions.submitted?.(report) : undefined;
  return (
    <>
      {extensions.banners?.(report)}
      <Banners report={report} today={today} preview={preview} />
      <div className="grid items-start gap-5 @min-[1080px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-4">
          {submittedHeader ?? (
            <Card className="flex-row flex-wrap items-center gap-3 px-5 py-4 sm:px-5 sm:py-4">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
                  {submitted
                    ? m.submittedHeading
                    : m.asAt(report.compiledAt ? formatDateTime(report.compiledAt) : '-')}
                </h2>
                {submitted ? (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {[report.reference, report.submittedAt && formatDateTime(report.submittedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : report.reviewedBy ? (
                  <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-success">
                    <Icon icon={UserCheck01Icon} className="size-3.5" />
                    {m.reviewedBy(report.reviewedBy.name, reviewedOn(document))}
                  </p>
                ) : null}
              </div>
              {recompile ? (
                <div className="ml-auto flex flex-wrap gap-2 @max-[699px]:ml-0 @max-[699px]:w-full @max-[699px]:[&>*]:flex-1">
                  {recompile}
                </div>
              ) : null}
            </Card>
          )}
          {extensions.partI?.(report) ?? <PartICard partI={document.partI} />}
          <PartHeading>{m.partII}</PartHeading>
          <DeclarationSections
            partII={document.partII}
            sectionProps={
              extensions.sectionProps
                ? (section) => extensions.sectionProps?.(section, report) ?? {}
                : undefined
            }
          />
          <ClarificationsSection clarifications={document.partII.clarifications} />
          <AccessSection
            accessRequests={document.partII.accessRequests}
            dataUnavailable={report.accessDataUnavailable}
          />
          {extensions.complaints?.(report) ?? (
            <ComplaintsCard complaints={document.partII.complaints} />
          )}
          <PartIIICard partIII={document.partIII} />
        </div>
        <aside className="grid gap-4 @min-[1080px]:sticky @min-[1080px]:top-[76px]">
          <SignOffCard steps={signOffSteps(report, missing)} />
          <SectionsCard document={document} />
        </aside>
      </div>
      {submitted ? null : (
        <WorkspaceFooter
          report={report}
          today={today}
          note={noteOf(report, preview, capabilities, extensions, actions !== null)}
          actions={actions}
        />
      )}
    </>
  );
}

/**
 * The footer's note: the extension's, null included, unless it has none (undefined); else, with
 * an action in the footer, none, and without one, why there is nothing to do.
 */
function noteOf(
  report: CompiledReport,
  preview: boolean,
  capabilities: FormMCapabilities,
  extensions: FormMReportExtensions,
  hasActions: boolean,
): string | null {
  const extended = preview ? undefined : extensions.footerNote?.(report);
  if (extended !== undefined) return extended;
  return hasActions ? null : footerNote(report, preview, capabilities);
}

/** Why the footer has no action for the viewer, if it says anything. */
function footerNote(
  report: ComplianceReport,
  preview: boolean,
  capabilities: FormMCapabilities,
): string | null {
  if (preview) return m.previewFooter(formatDate(yearEndOf(report.fy)));
  return capabilities.readOnly ? m.readOnly : null;
}

const STEP_MARKS = {
  done: 'bg-success-subtle text-success',
  current: 'bg-foreground text-background',
  upcoming: 'bg-card text-muted-foreground ring-[1.5px] ring-input ring-inset',
} as const;

/** Where the report stands from compile to submission. */
function SignOffCard({ steps }: { steps: SignOffStep[] }) {
  const headingId = useId();
  return (
    <Card role="region" aria-labelledby={headingId} className="gap-0 px-6 py-5 sm:px-6 sm:py-5">
      <h3 id={headingId} className="mb-3.5 text-[15px] font-semibold">
        {m.signOff}
      </h3>
      <ol className="grid">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="relative grid grid-cols-[24px_1fr] gap-2.5 pb-3.5 last:pb-0 before:absolute before:top-[26px] before:bottom-0.5 before:left-[11px] before:w-[1.5px] before:bg-border last:before:hidden"
          >
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full text-xs font-semibold',
                STEP_MARKS[step.state],
              )}
            >
              {step.state === 'done' ? (
                <Icon icon={Tick02Icon} strokeWidth={2.6} className="size-[13px]" />
              ) : (
                index + 1
              )}
            </span>
            <div>
              <div className="pt-0.5 text-sm leading-[1.35] font-medium">{step.label}</div>
              {step.detail ? (
                <div className="mt-px text-[12.5px] text-muted-foreground">{step.detail}</div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The parts of the form as links, with how many officers each list names. */
function SectionsCard({ document }: { document: NonNullable<ComplianceReport['document']> }) {
  const headingId = useId();
  const { partII } = document;
  const entries: [string, string, number | '-' | null][] = [
    [FORM_M_ANCHORS.partI, m.toc.partI, null],
    [FORM_M_ANCHORS.initial, m.toc.initial, partII.initial.notDeclared],
    [
      FORM_M_ANCHORS.biennial,
      m.toc.biennial,
      partII.biennial.noCycleInPeriod ? '-' : partII.biennial.notDeclared,
    ],
    [FORM_M_ANCHORS.final, m.toc.final, partII.final.notDeclared],
    [FORM_M_ANCHORS.clarifications, m.toc.clarifications, partII.clarifications.items.length],
    [FORM_M_ANCHORS.access, m.toc.access, null],
    [FORM_M_ANCHORS.complaints, m.toc.complaints, partII.complaints.items.length],
    [FORM_M_ANCHORS.partIII, m.toc.partIII, null],
  ];
  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className="hidden gap-0 px-6 py-5 sm:px-6 sm:py-5 @min-[700px]:flex"
    >
      <h3 id={headingId} className="mb-2 text-[15px] font-semibold">
        {m.sections}
      </h3>
      <nav aria-label={m.sectionsNav} className="flex flex-col gap-px">
        {entries.map(([anchor, label, count]) => (
          <a
            key={anchor}
            href={`#${anchor}`}
            className={cn(
              focusRing,
              'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] text-secondary-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {label}
            {count === null ? null : (
              <span
                className="ml-auto text-xs text-muted-foreground tabular-nums"
                title={typeof count === 'number' ? m.listed(count) : undefined}
              >
                {count}
              </span>
            )}
          </a>
        ))}
      </nav>
    </Card>
  );
}

const DUE_TONES = {
  neutral: 'text-foreground',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const;

/**
 * The sticky footer: the due date with days left or overdue, why the viewer has nothing to do,
 * and the step's action (Mark reviewed, Confirm and submit: #226).
 */
export function WorkspaceFooter({
  report,
  today,
  note,
  actions,
}: {
  report: ComplianceReport;
  today: string;
  note: string | null;
  actions?: ReactNode;
}) {
  const due = dueLine(report.dueDate, today);
  // Flush with the bottom, on a strip of the page's background wide enough to cover the cards'
  // shadows: the report scrolls out of sight above the bar, not through it or into a gap under it.
  return (
    <div className="sticky bottom-0 z-10 -mx-3 mt-1 bg-background px-3 pb-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-pop">
        <span className={cn('flex items-center gap-2 text-sm font-medium', DUE_TONES[due.tone])}>
          <Icon icon={Calendar03Icon} className="size-4" />
          {due.text}
        </span>
        {note ? (
          <span className="text-[13px] text-muted-foreground @max-[699px]:hidden">{note}</span>
        ) : null}
        {actions ? (
          <span className="ml-auto flex items-center gap-2 @max-[699px]:ml-0 @max-[699px]:w-full @max-[699px]:[&>*]:flex-1">
            {actions}
          </span>
        ) : null}
      </div>
    </div>
  );
}
