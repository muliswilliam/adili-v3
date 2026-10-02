import {
  AiLabel,
  type AiLabelDetails,
  Button,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FeedbackControl,
  focusRing,
  focusRingInset,
  Icon,
  IconTile,
  Skeleton,
  SourceRefLink,
  Spinner,
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@adili/ui';
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Clock01Icon,
  Flag02Icon,
  InformationCircleIcon,
  Message01Icon,
  PlusSignIcon,
  RefreshIcon,
  Shield01Icon,
  SparklesIcon,
  Tick02Icon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { formatRelativeTime } from '../../format';
import type {
  Copilot,
  CopilotAiLabel,
  CopilotExplanation,
  CopilotSourceRef,
  CopilotSummary,
} from '../../../server/copilot.server';
import type { CaseDetail, Flag } from '../../../server/review/types';
import {
  budgetResetDate,
  type CopilotAccess,
  failureReasonText,
  flagDone,
  launcherStatus,
  sortFlags,
  versionNumber,
} from './copilot-view';
import { messages as t } from './messages';
import { SeverityBadge } from './severity-badge';
import type { ResolvedRef } from './source-refs';
import type { CaseCopilot } from './use-case-copilot';

/**
 * The Copilot on a review case (spec 07c FE-2, S10, S11, S13, S15), as the 07a-review prototype
 * draws it: a launcher bar above the case's side tabs, and the panel that replaces them when
 * opened, with the Summary and Flags tabs. Every AI block carries an AI label; nothing here
 * decides anything.
 */

export type CopilotTab = 'summary' | 'flags';

const launcherTones = {
  ready: 'text-ai',
  busy: 'text-ai',
  warning: 'text-warning',
  off: 'text-muted-foreground',
} as const;

/** The Copilot bar above the case's side tabs: its state at a glance, and opens the panel. */
export function CopilotLauncher({
  state,
  onOpen,
}: {
  state: Pick<CaseCopilot, 'copilot' | 'error'>;
  onOpen: () => void;
}) {
  const { text, tone } = launcherStatus(state.copilot, state.error);
  const off = tone === 'off';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t.launcher.open(text)}
      className={cn(
        focusRing,
        'flex w-full cursor-pointer items-center gap-2.5 rounded-item bg-card py-2.5 pr-3 pl-2.5 text-left shadow-card transition-shadow hover:ring-1 hover:ring-ai',
      )}
    >
      <AiTile off={off} />
      <span className="text-[14.5px] font-semibold">{t.title}</span>
      <span
        className={cn(
          'ml-auto inline-flex items-center gap-[7px] text-[13px] font-medium',
          launcherTones[tone],
        )}
      >
        {tone === 'busy' ? <Spinner className="size-[13px]" /> : null}
        {tone === 'warning' ? <Icon icon={Alert02Icon} className="size-3.5" /> : null}
        {text}
      </span>
      <Icon icon={ArrowRight01Icon} className="text-muted-foreground" />
    </button>
  );
}

function AiTile({ off = false }: { off?: boolean }) {
  return (
    <IconTile
      size="xs"
      tone={off ? 'default' : 'ai'}
      className={cn(off && 'text-muted-foreground')}
    >
      <Icon icon={off ? UnavailableIcon : SparklesIcon} />
    </IconTile>
  );
}

export interface CopilotPanelProps {
  state: CaseCopilot;
  access: CopilotAccess;
  /** The case's flags (review.yaml `Flag`), explained on the Flags tab. */
  flags: Flag[];
  versions: CaseDetail['versions'];
  /** Reads a source ref against the case's declaration; null leaves the ref out. */
  resolveRef: (ref: CopilotSourceRef) => ResolvedRef | null;
  /** The case has an earlier declaration, so "Changes since previous version" can say none. */
  hasPrevious: boolean;
  onClose: () => void;
  /** Re-requests the outputs; the container shows what went wrong. */
  onRefresh: () => void;
  /** Opens a source ref's target in the declaration pane, highlighted. */
  onOpenSource: (resolved: ResolvedRef) => void;
  /**
   * Flags picked for a clarification ("Add to clarification", spec 07c FE-3), for the assignee.
   * Leave out to hide the buttons.
   */
  selection?: {
    flagIds: string[];
    onToggle: (flagId: string) => void;
    onClear: () => void;
    /** Opens the composer with the picked flags; leave out while there is no composer. */
    onCompose?: () => void;
    /** The six-month window for clarifications has closed. */
    composeDisabled?: boolean;
  };
  /** Opens a flag's explanation on the Flags tab (Explain on a flag); a new `key` each time. */
  explain?: { flagId: string; key: number } | null;
  now: Date;
}

/** The open Copilot panel, in each of its states. */
export function CopilotPanel({
  state,
  access,
  flags,
  versions,
  resolveRef,
  hasPrevious,
  onClose,
  onRefresh,
  onOpenSource,
  selection,
  explain,
  now,
}: CopilotPanelProps) {
  const headingId = useId();
  const [tab, setTab] = useState<CopilotTab>(explain ? 'flags' : 'summary');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    explain ? { [explain.flagId]: true } : {},
  );
  const [pulse, setPulse] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const { copilot, error, stopped, refreshing } = state;
  const status = copilot?.status ?? null;
  const busy = status === 'pending' || status === 'stale';
  const canRefresh = access !== 'viewer' && status !== 'not-enabled' && copilot !== null;

  function openFlag(flagId: string) {
    setTab('flags');
    setExpanded({ [flagId]: true });
    setPulse(flagId);
  }

  // Explain on a flag outside the panel: each new key opens that flag.
  const [explained, setExplained] = useState(explain?.key);
  if (explain && explain.key !== explained) {
    setExplained(explain.key);
    openFlag(explain.flagId);
  }

  useEffect(() => {
    if (!pulse) return;
    document
      .getElementById(flagAnchor(pulse))
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const timer = setTimeout(() => {
      setPulse(null);
    }, 1_700);
    return () => {
      clearTimeout(timer);
    };
  }, [pulse]);

  const content = copilot && (status === 'ready' || status === 'stale') ? copilot.summary : null;

  const top = (
    <div className="sticky top-0 z-[3] rounded-t-2xl bg-card">
      <div className="flex items-center gap-2.5 pt-3 pr-2.5 pl-3.5">
        <AiTile />
        <h2 id={headingId} className="text-[15px] font-semibold">
          {t.title}
        </h2>
        <span className="flex-1" />
        {canRefresh ? (
          <Tooltip content={t.refreshTip}>
            <Button
              variant="ghost"
              size="icon"
              className="[&_svg]:size-4"
              aria-label={t.refresh}
              disabled={busy || refreshing}
              onClick={onRefresh}
            >
              <Icon icon={RefreshIcon} />
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content={t.closeTip}>
          <Button
            variant="ghost"
            size="icon"
            className="[&_svg]:size-[17px]"
            aria-label={t.close}
            onClick={onClose}
          >
            <Icon icon={Cancel01Icon} />
          </Button>
        </Tooltip>
      </div>
      {copilot && content ? (
        <>
          <PanelLabel copilot={copilot} label={content.label} versions={versions} now={now} />
          <TabsList aria-label={t.tabs.label} className="mt-1.5 px-2">
            <TabsTrigger value="summary" className="px-2 text-[13.5px]">
              {t.tabs.summary}
            </TabsTrigger>
            <TabsTrigger value="flags" className="px-2 text-[13.5px]">
              {t.tabs.flags}
              <TabsCount>{flags.length}</TabsCount>
            </TabsTrigger>
          </TabsList>
          {tab === 'flags' && selection && access === 'assignee' ? (
            <SelectionBar selection={selection} />
          ) : null}
        </>
      ) : null}
    </div>
  );

  const live = (
    <div className="sr-only" role="status" aria-live="polite">
      {status === 'pending'
        ? t.live.pending
        : status === 'stale'
          ? t.live.stale
          : status === 'ready'
            ? t.live.ready
            : ''}
    </div>
  );

  let body: ReactNode;
  if (!copilot) {
    body = error ? (
      <PanelBody>
        <Callout
          tone="warning"
          icon={Alert02Icon}
          action={
            error === 'unavailable' ? (
              <RetryButton onClick={state.retry}>{t.tryAgain}</RetryButton>
            ) : null
          }
        >
          {error === 'unauthenticated' ? t.sessionEnded : t.loadFailed}
        </Callout>
        <p className="text-[13px] text-muted-foreground">{t.worksAsUsual}</p>
      </PanelBody>
    ) : (
      <Waiting stopped={false} onCheckAgain={state.retry} />
    );
  } else if (status === 'not-enabled') {
    body = (
      <NotEnabled
        onLearnWhy={() => {
          setWhyOpen(true);
        }}
      />
    );
  } else if (status === 'failed') {
    body = (
      <Failed
        reason={copilot.failureReason}
        canRetry={canRefresh && copilot.failureReason !== 'budget'}
        retrying={refreshing}
        onRetry={onRefresh}
        now={now}
      />
    );
  } else if (!content) {
    body = <Waiting stopped={stopped} onCheckAgain={state.retry} />;
  } else {
    const stale = status === 'stale';
    body = (
      <>
        <TabContent value="summary" stale={stale} stopped={stopped} onCheckAgain={state.retry}>
          <SummaryTab
            summary={content}
            flags={flags}
            resolveRef={resolveRef}
            hasPrevious={hasPrevious}
            onOpenSource={onOpenSource}
            onOpenFlag={openFlag}
            rating={
              <Rating
                state={state}
                access={access}
                jobId={copilot.jobs.summarize}
                label={content.label}
                group={t.rateSummary}
              />
            }
          />
        </TabContent>
        <TabContent value="flags" stale={stale} stopped={stopped} onCheckAgain={state.retry}>
          <FlagsTab
            flags={flags}
            explanations={copilot.explanations?.explanations ?? []}
            label={copilot.explanations?.label ?? null}
            expanded={expanded}
            pulse={pulse}
            onToggle={(flagId) => {
              setExpanded((current) => ({ ...current, [flagId]: !current[flagId] }));
            }}
            resolveRef={resolveRef}
            onOpenSource={onOpenSource}
            selection={access === 'assignee' ? selection : undefined}
            rating={
              copilot.explanations ? (
                <Rating
                  state={state}
                  access={access}
                  jobId={copilot.jobs.explain}
                  label={copilot.explanations.label}
                  group={t.rateExplanations}
                />
              ) : null
            }
          />
        </TabContent>
      </>
    );
  }

  const panel = (
    <aside
      aria-labelledby={headingId}
      className="min-h-[200px] rounded-2xl bg-card text-card-foreground shadow-card"
    >
      {top}
      {live}
      {body}
      <WhyDialog open={whyOpen} onOpenChange={setWhyOpen} />
    </aside>
  );

  return content ? (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value as CopilotTab);
      }}
    >
      {panel}
    </Tabs>
  ) : (
    panel
  );
}

function PanelLabel({
  copilot,
  label,
  versions,
  now,
}: {
  copilot: Copilot;
  label: CopilotAiLabel;
  versions: CaseDetail['versions'];
  now: Date;
}) {
  const generatedAt = copilot.generatedAt ?? label.generatedAt;
  return (
    <div className="flex px-3.5 pt-2">
      <AiLabel
        details={labelDetails(label)}
        text={t.label(
          formatRelativeTime(generatedAt, now),
          versionNumber(copilot.forVersionId, versions),
        )}
      />
    </div>
  );
}

function labelDetails(label: CopilotAiLabel): AiLabelDetails {
  return {
    task: label.task,
    provider: label.provider,
    model: label.model,
    promptVersion: label.promptVersion,
    generatedAt: label.generatedAt,
  };
}

function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-3.5 p-4', className)}>{children}</div>;
}

function TabContent({
  value,
  stale,
  stopped,
  onCheckAgain,
  children,
}: {
  value: CopilotTab;
  stale: boolean;
  /** Polling stopped while still stale. */
  stopped: boolean;
  onCheckAgain: () => void;
  children: ReactNode;
}) {
  return (
    <TabsContent value={value} className="mt-0 rounded-none rounded-b-2xl">
      <PanelBody>
        {stale && stopped ? (
          <Callout
            tone="neutral"
            icon={Clock01Icon}
            action={<RetryButton onClick={onCheckAgain}>{t.checkAgain}</RetryButton>}
          >
            {t.stillUpdating}
          </Callout>
        ) : stale ? (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-lg bg-ai-subtle px-3 py-2.5 text-[13.5px] font-medium text-ai-subtle-foreground"
          >
            <Spinner className="size-3.5 text-ai" />
            {t.stale}
          </div>
        ) : null}
        <p className="flex items-start gap-2 text-[13px] font-medium text-secondary-foreground">
          <Icon icon={InformationCircleIcon} className="mt-0.5 size-3.5 text-ai" />
          <span>{t.disclaimer}</span>
        </p>
        {stale ? (
          <div aria-hidden="true" inert className="grid gap-3.5 opacity-45 select-none">
            {children}
          </div>
        ) : (
          children
        )}
      </PanelBody>
    </TabsContent>
  );
}

function Callout({
  tone,
  icon,
  action,
  children,
}: {
  tone: 'warning' | 'neutral';
  icon: Parameters<typeof Icon>[0]['icon'];
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm leading-normal',
        tone === 'warning'
          ? 'bg-warning-subtle text-warning-subtle-foreground'
          : 'bg-muted text-secondary-foreground',
      )}
    >
      <Icon icon={icon} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

function RetryButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="secondary"
      size="xs"
      className="-my-0.5 [&_svg]:size-[13px]"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={RefreshIcon} />
      {children}
    </Button>
  );
}

const SKELETON_WIDTHS = [92, 80, 96, 60, 0, 40, 88, 75, 83, 0, 45, 90, 70];

function Waiting({ stopped, onCheckAgain }: { stopped: boolean; onCheckAgain: () => void }) {
  return (
    <PanelBody className="pt-3">
      {stopped ? (
        <Callout
          tone="neutral"
          icon={Clock01Icon}
          action={<RetryButton onClick={onCheckAgain}>{t.checkAgain}</RetryButton>}
        >
          {t.stillPreparing}
        </Callout>
      ) : (
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-ai">
          <Spinner className="size-3.5" />
          {t.pending}
        </p>
      )}
      <div className="grid gap-2.5" aria-busy="true">
        {SKELETON_WIDTHS.map((width, index) =>
          width ? (
            <Skeleton key={index} style={{ width: `${String(width)}%` }} />
          ) : (
            <span key={index} aria-hidden="true" className="h-1.5" />
          ),
        )}
      </div>
    </PanelBody>
  );
}

function NotEnabled({ onLearnWhy }: { onLearnWhy: () => void }) {
  return (
    <div className="grid justify-items-center gap-2.5 px-5 pt-9 pb-10 text-center">
      <IconTile size="lg" className="text-muted-foreground">
        <Icon icon={UnavailableIcon} />
      </IconTile>
      <p className="max-w-[300px] text-sm">{t.notEnabled}</p>
      <Button variant="link" className="text-sm" onClick={onLearnWhy}>
        {t.learnWhy}
      </Button>
    </div>
  );
}

function Failed({
  reason,
  canRetry,
  retrying,
  onRetry,
  now,
}: {
  reason: string | null;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
  now: Date;
}) {
  return (
    <PanelBody>
      <Callout
        tone="warning"
        icon={Alert02Icon}
        action={
          canRetry ? (
            <RetryButton onClick={onRetry} disabled={retrying}>
              {t.tryAgain}
            </RetryButton>
          ) : null
        }
      >
        {t.failed(failureReasonText(reason))}
        {reason === 'budget' ? (
          <div className="mt-0.5 text-[13px]">{t.budgetResets(budgetResetDate(now))}</div>
        ) : null}
      </Callout>
      <p className="text-[13px] text-muted-foreground">{t.worksAsUsual}</p>
    </PanelBody>
  );
}

function WhyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3">
          <IconTile tone="default">
            <Icon icon={Shield01Icon} />
          </IconTile>
          <DialogTitle>{t.why.title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-3 text-[15px] leading-relaxed">
          {t.why.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t.why.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The rating of one output (a job): the officer holding the case rates it; a supervisor sees
 * the rating; anyone else sees nothing. One rating per reviewer per output, as review.yaml has it.
 */
function Rating({
  state,
  access,
  jobId,
  label,
  group,
}: {
  state: CaseCopilot;
  access: CopilotAccess;
  jobId: string | null;
  label: CopilotAiLabel;
  group: string;
}) {
  const value = state.ratingOf(jobId);
  if (access === 'viewer' || !jobId) return null;
  if (access === 'supervisor' && !value) return null;
  return (
    <div className="relative border-t pt-3">
      <div className="pointer-events-none absolute top-3 left-0 flex h-7 items-center gap-2">
        <AiLabel
          size="sm"
          text={t.labelShort}
          details={labelDetails(label)}
          className="pointer-events-auto"
        />
        {access === 'assignee' ? (
          <span className="text-[13px] text-muted-foreground">{group}</span>
        ) : null}
      </div>
      <FeedbackControl
        className={access === 'supervisor' ? 'flex h-7 justify-end' : 'w-full'}
        value={value}
        readOnly={access === 'supervisor'}
        messages={{ group }}
        onRate={(feedback) => state.rate(jobId, feedback)}
      />
    </div>
  );
}

function Block({
  title,
  label,
  children,
}: {
  title: string;
  label: CopilotAiLabel;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-2 border-t pt-3.5 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="flex min-h-7 items-center gap-2">
        <h3 id={headingId} className="text-[13.5px] font-semibold">
          {title}
        </h3>
        <AiLabel size="sm" text={t.labelShort} details={labelDetails(label)} />
      </div>
      {children}
    </section>
  );
}

function Refs({
  refs,
  resolveRef,
  onOpenSource,
}: {
  refs: CopilotSourceRef[];
  resolveRef: CopilotPanelProps['resolveRef'];
  onOpenSource: CopilotPanelProps['onOpenSource'];
}) {
  const resolved = refs.flatMap((ref) => {
    const one = resolveRef(ref);
    return one ? [one] : [];
  });
  if (resolved.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {resolved.map((one) => (
        <SourceRefLink
          key={one.anchorId}
          sourceRef={one.ref}
          label={one.label}
          targetLabel={one.targetLabel}
          onOpen={() => {
            onOpenSource(one);
          }}
        />
      ))}
    </div>
  );
}

const textClassName = 'text-sm leading-[1.55] text-foreground';
const quietClassName = 'text-[13.5px] text-muted-foreground';

function SummaryTab({
  summary,
  flags,
  resolveRef,
  hasPrevious,
  onOpenSource,
  onOpenFlag,
  rating,
}: {
  summary: CopilotSummary;
  flags: Flag[];
  resolveRef: CopilotPanelProps['resolveRef'];
  hasPrevious: boolean;
  onOpenSource: CopilotPanelProps['onOpenSource'];
  onOpenFlag: (flagId: string) => void;
  rating: ReactNode;
}) {
  const { label } = summary;
  const refs = (list: CopilotSourceRef[]) => (
    <Refs refs={list} resolveRef={resolveRef} onOpenSource={onOpenSource} />
  );
  const flagById = new Map(flags.map((flag) => [flag.id, flag]));
  return (
    <>
      <Block title={t.blocks.overview} label={label}>
        <p className={textClassName}>{summary.overview}</p>
      </Block>
      <Block title={t.blocks.changes} label={label}>
        {summary.changesSincePrevious.length > 0 ? (
          <ul className="grid gap-3">
            {summary.changesSincePrevious.map((change) => (
              <li key={change.text} className={textClassName}>
                {change.text}
                {refs(change.refs)}
              </li>
            ))}
          </ul>
        ) : (
          <p className={quietClassName}>{hasPrevious ? t.noChanges : t.firstDeclaration}</p>
        )}
      </Block>
      {summary.sections.length > 0 ? (
        <Block title={t.blocks.sections} label={label}>
          <div className="grid gap-2.5">
            {summary.sections.map((section) => {
              const head = resolveRef({
                sectionKey: section.sectionKey,
                personKey: null,
                itemId: null,
                fieldPath: null,
              });
              return (
                <div key={section.sectionKey}>
                  {head ? (
                    <div className="mb-0.5 text-[12.5px] font-semibold text-muted-foreground">
                      {head.label}
                    </div>
                  ) : null}
                  <p className={textClassName}>{section.text}</p>
                  {refs(section.refs)}
                </div>
              );
            })}
          </div>
        </Block>
      ) : null}
      <Block title={t.blocks.attention} label={label}>
        {summary.worthAttention.length > 0 ? (
          <ul className="grid gap-3">
            {summary.worthAttention.map((point) => (
              <li key={point.text} className={textClassName}>
                {point.text}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {point.flagIds.flatMap((flagId) => {
                    const flag = flagById.get(flagId);
                    return flag ? [<FlagLink key={flagId} flag={flag} onOpen={onOpenFlag} />] : [];
                  })}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={quietClassName}>{t.noAttention}</p>
        )}
      </Block>
      {rating}
    </>
  );
}

function FlagLink({ flag, onOpen }: { flag: Flag; onOpen: (flagId: string) => void }) {
  return (
    <button
      type="button"
      aria-label={t.openFlag(flag.title)}
      onClick={() => {
        onOpen(flag.id);
      }}
      className={cn(
        focusRing,
        'inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full py-0.5 pr-2 pl-[3px] text-[12.5px] font-medium text-foreground ring-1 ring-border hover:ring-secondary-foreground',
      )}
    >
      <SeverityBadge severity={flag.severity} size="sm" />
      <span className="truncate">{flag.title}</span>
    </button>
  );
}

const flagAnchor = (flagId: string) => `copilot-flag-${flagId}`;

function FlagsTab({
  flags,
  explanations,
  label,
  expanded,
  pulse,
  onToggle,
  resolveRef,
  onOpenSource,
  selection,
  rating,
}: {
  flags: Flag[];
  explanations: CopilotExplanation[];
  label: CopilotAiLabel | null;
  expanded: Record<string, boolean>;
  pulse: string | null;
  onToggle: (flagId: string) => void;
  resolveRef: CopilotPanelProps['resolveRef'];
  onOpenSource: CopilotPanelProps['onOpenSource'];
  selection: CopilotPanelProps['selection'];
  rating: ReactNode;
}) {
  if (flags.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={Flag02Icon} />}
        title={t.flags.none}
        description={t.flags.noneDetail}
      />
    );
  }
  const byFlag = new Map(explanations.map((each) => [each.flagId, each]));
  return (
    <>
      <div className="grid gap-2.5">
        {sortFlags(flags).map((flag) => (
          <FlagExplanation
            key={flag.id}
            flag={flag}
            explanation={byFlag.get(flag.id) ?? null}
            label={label}
            open={Boolean(expanded[flag.id])}
            pulse={pulse === flag.id}
            onToggle={() => {
              onToggle(flag.id);
            }}
            resolveRef={resolveRef}
            onOpenSource={onOpenSource}
            selection={selection}
          />
        ))}
      </div>
      {rating}
    </>
  );
}

function FlagExplanation({
  flag,
  explanation,
  label,
  open,
  pulse,
  onToggle,
  resolveRef,
  onOpenSource,
  selection,
}: {
  flag: Flag;
  explanation: CopilotExplanation | null;
  label: CopilotAiLabel | null;
  open: boolean;
  pulse: boolean;
  onToggle: () => void;
  resolveRef: CopilotPanelProps['resolveRef'];
  onOpenSource: CopilotPanelProps['onOpenSource'];
  selection: CopilotPanelProps['selection'];
}) {
  const bodyId = useId();
  const done = flagDone(flag);
  const added = selection?.flagIds.includes(flag.id) ?? false;
  const canAdd = selection !== undefined && !done;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      id={flagAnchor(flag.id)}
      className={cn(
        'scroll-mt-[150px] overflow-hidden rounded-xl shadow-card',
        pulse && 'animate-[copilot-flag-pulse_1.6s_ease-out] motion-reduce:animate-none',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={onToggle}
        className={cn(
          focusRingInset,
          'flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-[11px] text-left',
        )}
      >
        {done ? (
          <Icon icon={Tick02Icon} strokeWidth={2.4} className="size-[15px] text-success" />
        ) : (
          <SeverityBadge severity={flag.severity} />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 text-[13.5px] leading-[1.35]',
            done ? 'font-medium text-secondary-foreground' : 'font-semibold',
          )}
        >
          {flag.title}
        </span>
        {done ? (
          <span className="text-[13px] text-muted-foreground">
            {flag.closedReason ? t.flags.closed : t.flags.reviewed}
          </span>
        ) : null}
        <Icon
          icon={ArrowDown01Icon}
          className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div id={bodyId} className="grid gap-2.5 px-3.5 pt-0.5 pb-3 text-[13.5px]">
          {explanation ? (
            <>
              <div>
                <div className="mb-0.5 text-xs font-semibold text-muted-foreground">
                  {t.flags.meaning}
                </div>
                <p>{explanation.meaning}</p>
              </div>
              <div>
                <div className="mb-0.5 text-xs font-semibold text-muted-foreground">
                  {t.flags.check}
                </div>
                <ol className="grid list-decimal gap-[3px] pl-[18px]">
                  {explanation.whatToCheck.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="mb-0.5 text-xs font-semibold text-muted-foreground">
                  {t.flags.resolves}
                </div>
                <p>{explanation.typicalResolution}</p>
              </div>
              <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Icon icon={InformationCircleIcon} className="size-[13px]" />
                {t.flags.notFinding}
              </p>
              <Refs
                refs={explanation.refs.filter((each) => each.itemId)}
                resolveRef={resolveRef}
                onOpenSource={onOpenSource}
              />
            </>
          ) : (
            <p className={quietClassName}>{t.flags.noExplanation}</p>
          )}
          {(explanation && label) || canAdd ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
              {explanation && label ? (
                <AiLabel size="sm" text={t.labelShort} details={labelDetails(label)} />
              ) : null}
              <span className="flex-1" />
              {canAdd ? (
                <Button
                  variant={added ? 'secondary' : 'ghost'}
                  size="xs"
                  aria-pressed={added}
                  onClick={() => {
                    selection.onToggle(flag.id);
                  }}
                >
                  <Icon icon={added ? Tick02Icon : PlusSignIcon} />
                  {added ? t.flags.added : t.flags.add}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SelectionBar({ selection }: { selection: NonNullable<CopilotPanelProps['selection']> }) {
  if (selection.flagIds.length === 0) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b bg-ai-subtle py-2 pr-3 pl-4 text-[13px] font-semibold text-ai-subtle-foreground"
    >
      <span className="flex-1">{t.flags.selected(selection.flagIds.length)}</span>
      <Button variant="ghost" size="xs" onClick={selection.onClear}>
        {t.flags.clear}
      </Button>
      {selection.onCompose ? (
        <Button size="xs" disabled={selection.composeDisabled} onClick={selection.onCompose}>
          <Icon icon={Message01Icon} />
          {t.flags.newClarification}
        </Button>
      ) : null}
    </div>
  );
}
