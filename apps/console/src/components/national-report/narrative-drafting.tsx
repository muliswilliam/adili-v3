import {
  AiLabel,
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  IconTile,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  NATIONAL_REPORT_NARRATIVE_SECTIONS,
  RadioCard,
  RadioGroup,
  Skeleton,
  Spinner,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  RefreshIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useState } from 'react';

import type {
  NarrativeDraftRequest,
  NationalReportResult,
} from '../../server/national-report.server';
import {
  NARRATIVE_SECTION_IDS,
  type NarrativeDraftSection,
  type NarrativeSectionId,
  type NationalReport,
  sectionsDrafted,
} from '../../server/reporting/types';
import type { ServiceError } from '../../server/service-call';
import { messages as m } from './messages';
import type { NarrativeEditorValue } from './model';
import type { NcrExtensionContext, NcrExtensions } from './national-report-view';

export type NarrativeDraftAsk = (
  fy: number,
  request: NarrativeDraftRequest,
  idempotencyKey: string,
) => Promise<NationalReportResult<NationalReport>>;

export type NationalReportLoad = (fy: number) => Promise<NationalReportResult<NationalReport>>;

export interface NcrDraftingOptions {
  fy: number;
  /** The year's report as the page has it. */
  report: NationalReport | null;
  /** Asks the reporting service for a draft (`draftNationalReportNarrative`). */
  draft: NarrativeDraftAsk;
  /** Reads the report, to see whether a draft answered 202 has ended. */
  load: NationalReportLoad;
  onUnauthenticated: () => void;
  /** #331's figure chips (`useNcrPatterns().paragraphMeta`), shown after the "Edited" label. */
  figures?: NcrExtensions['paragraphMeta'];
  /** How often, and how many times, to read the report while a draft is being written. */
  pollMs?: number;
  polls?: number;
}

/**
 * Where the analyst's latest ask stands. While drafting: `saving`, edits not saved yet are being
 * saved first (the draft's answer replaces the narrative being edited); `asking`, the request is
 * out; `polling`, the job is being written and the report is read until it ends.
 */
type DraftState =
  | { status: 'idle' }
  | { status: 'drafting'; ask: NarrativeDraftRequest; phase: 'saving' | 'asking' | 'polling' }
  | { status: 'failed'; ask: NarrativeDraftRequest; message: string };

const SECTION_LABELS: Record<NarrativeSectionId, string> = Object.fromEntries(
  NATIONAL_REPORT_NARRATIVE_SECTIONS.map((section) => [section.id, section.label]),
) as Record<NarrativeSectionId, string>;

const POLL_MS = 2_000;
/** About two minutes of a job being written before the page says it is taking long. */
const POLLS = 60;

/** "all sections" or "findings", as the toast and the redraft dialog name what was drafted. */
function draftedName(section: NarrativeDraftSection): string {
  return section === 'all' ? m.allSectionsLower : SECTION_LABELS[section].toLowerCase();
}

/** Why a draft was discarded, in the analyst's words, from the job's reason or the problem code. */
function reasonMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'validation':
    case 'narrative-validation':
      return m.draftValidation;
    case 'ai-not-enabled':
    case 'policy':
      return m.draftNotEnabled;
    case 'no-pattern-candidates':
      return m.draftNoCandidates;
    case 'aggregates-rebuilt':
      return m.draftRebuilt;
    case 'budget':
      return m.draftBudget;
    case 'invalid-output':
      return m.draftUnreadable;
    default:
      return m.draftUnavailable;
  }
}

/**
 * The NCR builder's AI narrative drafting (spec 09b FE-2, S2 and S3, #341), as the page's
 * extensions:
 * - `narrativeActions`: the "Draft narrative" menu (All sections, Overview, Findings,
 *   Recommendations) for the analyst writing a draft report. A section with text asks first
 *   whether to replace only its AI-draft paragraphs (the default) or all of it.
 * - `sectionBody`: "Drafting findings…" in place of each section being drafted.
 * - `narrativeNotice`: why a draft was discarded, with Try again; the toast says it too.
 * - `paragraphMeta`: "Edited" on a paragraph that was an AI draft until the analyst changed it
 *   (the page labels AI drafts), then #331's figure chips (`figures`).
 * The draft lands through the page's `adoptReport`; a draft answered 202 (or one being written
 * when the page loaded) is followed by reading the report until it ends.
 */
export function useNcrNarrativeDrafting(options: NcrDraftingOptions): NcrExtensions {
  const { fy, report, draft, figures, onUnauthenticated } = options;
  const router = useRouter();
  const { toast } = useToast();
  // A draft being written when the page loaded: follow it.
  const [state, setState] = useState<DraftState>(() => followed(report) ?? { status: 'idle' });
  // The job last followed, so a report still saying it is being written is not followed twice.
  const [job, setJob] = useState(() => report?.narrativeDraft?.jobId ?? null);
  // Paragraphs seen as AI drafts: one of them no longer marked so was edited by the analyst.
  const [drafted, setDrafted] = useState<ReadonlySet<string>>(() => aiDraftIds(report, new Set()));
  const [seen, setSeen] = useState(report);
  if (report !== seen) {
    setSeen(report);
    setDrafted((ids) => aiDraftIds(report, ids));
    // A draft asked for elsewhere (another tab) is being written: follow it too.
    const next = followed(report);
    const jobId = report?.narrativeDraft?.jobId ?? null;
    if (next && jobId !== job && state.status === 'idle') {
      setJob(jobId);
      setState(next);
    }
  }

  const fail = (ask: NarrativeDraftRequest, message: string) => {
    setState({ status: 'failed', ask, message });
    toast({ title: message, urgency: 'assertive' });
  };

  /**
   * A draft that ended without one, for `reason` (a job's failure reason or a problem code).
   * Approved meanwhile: the reloaded page shows the report frozen; nothing failed.
   */
  const discarded = (ask: NarrativeDraftRequest, reason: string | null | undefined) => {
    if (reason === 'ncr-approved') {
      setState({ status: 'idle' });
      void router.invalidate();
    } else fail(ask, reasonMessage(reason));
  };

  /** The report the service answered once the job ended: the draft inserted, or discarded. */
  const onDraftEnded = (
    ask: NarrativeDraftRequest,
    answered: NationalReport,
    context: NcrExtensionContext,
  ) => {
    const outcome = answered.narrativeDraft;
    if (outcome?.status === 'failed') {
      discarded(ask, outcome.failureReason);
      return;
    }
    setDrafted((ids) => aiDraftIds(answered, ids));
    context.adoptReport(answered);
    setState({ status: 'idle' });
    const count = answered.narrativeParagraphs.filter(
      (each) => each.aiDraft && sectionsDrafted(ask.section).includes(each.section),
    ).length;
    toast({ title: m.drafted(draftedName(ask.section), count) });
  };

  const onDraftRefused = (ask: NarrativeDraftRequest, error: ServiceError) => {
    if (error.kind === 'unauthenticated') {
      setState({ status: 'idle' });
      onUnauthenticated();
      return;
    }
    if (error.kind !== 'problem') {
      fail(ask, m.draftUnavailable);
      return;
    }
    // The contract's codes for drafts (#338) are not registered with api-kit yet (#566).
    const code: string | undefined = (error.problem as { code?: string }).code;
    if (error.problem.status === 403) fail(ask, m.draftForbidden);
    else discarded(ask, code);
  };

  const send = async (ask: NarrativeDraftRequest, context: NcrExtensionContext) => {
    setState({ status: 'drafting', ask, phase: 'asking' });
    const result = await draft(fy, ask, crypto.randomUUID());
    if (!result.ok) {
      onDraftRefused(ask, result.error);
      return;
    }
    if (result.data.narrativeDraft?.status === 'drafting') {
      setJob(result.data.narrativeDraft.jobId);
      setState({ status: 'drafting', ask, phase: 'polling' });
      return;
    }
    onDraftEnded(ask, result.data, context);
  };

  /** Asks for the draft once the edits on screen are saved, so the draft's answer keeps them. */
  const ask = (request: NarrativeDraftRequest, context: NcrExtensionContext) => {
    if (context.unsaved === 'failed') fail(request, m.draftUnsaved);
    else if (context.unsaved === 'saving') {
      setState({ status: 'drafting', ask: request, phase: 'saving' });
    } else void send(request, context);
  };

  const drafting = state.status === 'drafting' ? state.ask : null;

  return {
    narrativeActions: (context) =>
      context.canEdit ? (
        <DraftNarrativeMenu
          state={state}
          context={context}
          options={options}
          onAsk={(request) => {
            ask(request, context);
          }}
          onSaved={() => {
            if (state.status !== 'drafting' || state.phase !== 'saving') return;
            if (context.unsaved === 'none') void send(state.ask, context);
            else if (context.unsaved === 'failed') fail(state.ask, m.draftUnsaved);
          }}
          onEnded={(answered) => {
            if (state.status !== 'drafting') return;
            if (answered.narrativeDraft) onDraftEnded(state.ask, answered, context);
            // A report without its draft: the service does not keep drafts.
            else fail(state.ask, m.draftUnavailable);
          }}
        />
      ) : null,
    sectionBody: (section, context) =>
      context.canEdit && drafting && sectionsDrafted(drafting.section).includes(section) ? (
        <DraftingSection label={SECTION_LABELS[section]} />
      ) : null,
    narrativeBusy: (context) => context.canEdit && state.status === 'drafting',
    narrativeNotice: (context) =>
      context.canEdit && state.status === 'failed' ? (
        <DraftError
          message={state.message}
          onRetry={() => {
            ask(state.ask, context);
          }}
          onDismiss={() => {
            setState({ status: 'idle' });
          }}
        />
      ) : null,
    paragraphMeta: (paragraph, context) => {
      const edited = !paragraph.aiDraft && drafted.has(paragraph.id);
      const chips = figures?.(paragraph, context) ?? null;
      if (!edited && chips === null) return null;
      return (
        <>
          {edited ? (
            <AiLabel size="sm" edited editedText={m.edited} messages={{ noDetails: m.editedTip }} />
          ) : null}
          {chips}
        </>
      );
    },
  };
}

/** Drafting, following the report's draft, when it is still being written. */
function followed(report: NationalReport | null): DraftState | null {
  const job = report?.narrativeDraft;
  if (job?.status !== 'drafting') return null;
  return {
    status: 'drafting',
    ask: { section: job.section, replaceAll: job.replaceAll },
    phase: 'polling',
  };
}

function aiDraftIds(report: NationalReport | null, ids: ReadonlySet<string>): ReadonlySet<string> {
  const fresh = (report?.narrativeParagraphs ?? []).filter(
    (each) => each.aiDraft && !ids.has(each.id),
  );
  if (fresh.length === 0) return ids;
  return new Set([...ids, ...fresh.map((each) => each.id)]);
}

/** The narrative's written paragraphs in `sections`, and how many the analyst wrote or edited. */
function writtenIn(value: NarrativeEditorValue, sections: readonly NarrativeSectionId[]) {
  const written = sections.flatMap((section) =>
    (value[section] ?? []).filter((each) => each.text.trim() !== ''),
  );
  return { total: written.length, mine: written.filter((each) => !each.aiDraft).length };
}

function DraftNarrativeMenu({
  state,
  context,
  options,
  onAsk,
  onSaved,
  onEnded,
}: {
  state: DraftState;
  context: NcrExtensionContext;
  options: NcrDraftingOptions;
  onAsk: (ask: NarrativeDraftRequest) => void;
  /** The edits being saved before the ask are saved, or were refused. */
  onSaved: () => void;
  onEnded: (report: NationalReport) => void;
}) {
  const [redraft, setRedraft] = useState<NarrativeDraftSection | null>(null);
  const phase = state.status === 'drafting' ? state.phase : null;
  const poll = useDraftPoll(phase === 'polling', options, onEnded);
  const saved = useEffectEvent(onSaved);
  const { unsaved } = context;
  useEffect(() => {
    if (phase === 'saving' && unsaved !== 'saving') saved();
  }, [phase, unsaved]);

  if (state.status === 'drafting') {
    return (
      <span className="flex items-center gap-2.5">
        {poll.exhausted ? (
          <>
            <span className="text-[13px] text-muted-foreground">{m.draftSlow}</span>
            <Button variant="secondary" size="sm" onClick={poll.restart}>
              <Icon icon={RefreshIcon} />
              {m.checkAgain}
            </Button>
          </>
        ) : null}
        <Button variant="secondary" size="sm" disabled aria-busy="true">
          <Spinner className="size-[13px]" />
          {m.drafting}
        </Button>
      </span>
    );
  }

  const pick = (section: NarrativeDraftSection) => {
    if (writtenIn(context.narrative, sectionsDrafted(section)).total > 0) setRedraft(section);
    else onAsk({ section, replaceAll: false });
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Icon icon={SparklesIcon} />
            {m.draftNarrative}
            <Icon icon={ArrowDown01Icon} />
          </Button>
        </MenuTrigger>
        <MenuContent>
          {(['all', ...NARRATIVE_SECTION_IDS] as const).map((section) => (
            <MenuItem
              key={section}
              onSelect={() => {
                pick(section);
              }}
            >
              {section === 'all' ? m.draftAll : SECTION_LABELS[section]}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      {redraft ? (
        <RedraftDialog
          section={redraft}
          narrative={context.narrative}
          onCancel={() => {
            setRedraft(null);
          }}
          onRedraft={(replaceAll) => {
            setRedraft(null);
            onAsk({ section: redraft, replaceAll });
          }}
        />
      ) : null}
    </>
  );
}

/**
 * While a draft is being written, reads the report every `pollMs` until its draft has ended, at
 * most `polls` times; `exhausted` then, until `restart`.
 */
function useDraftPoll(
  active: boolean,
  { fy, load, onUnauthenticated, pollMs = POLL_MS, polls = POLLS }: NcrDraftingOptions,
  onEnded: (report: NationalReport) => void,
) {
  const [round, setRound] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const end = useEffectEvent(onEnded);
  const signIn = useEffectEvent(onUnauthenticated);
  useEffect(() => {
    if (!active) return;
    let current = true;
    let count = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      if (count >= polls) {
        setExhausted(true);
        return;
      }
      count += 1;
      timer = setTimeout(() => {
        void load(fy).then((result) => {
          if (!current) return;
          if (result.ok && result.data.narrativeDraft?.status !== 'drafting') end(result.data);
          else if (!result.ok && result.error.kind === 'unauthenticated') signIn();
          else next();
        });
      }, pollMs);
    };
    next();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, fy, load, pollMs, polls, round]);
  return {
    exhausted: active && exhausted,
    restart: () => {
      setExhausted(false);
      setRound((count) => count + 1);
    },
  };
}

function RedraftDialog({
  section,
  narrative,
  onCancel,
  onRedraft,
}: {
  section: NarrativeDraftSection;
  narrative: NarrativeEditorValue;
  onCancel: () => void;
  onRedraft: (replaceAll: boolean) => void;
}) {
  const [replaceAll, setReplaceAll] = useState(false);
  const { total, mine } = writtenIn(narrative, sectionsDrafted(section));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile tone="ai">
            <Icon icon={SparklesIcon} />
          </IconTile>
          <DialogTitle>{m.redraftTitle(draftedName(section))}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <RadioGroup legend={m.redraftLegend} legendHidden>
            <RadioCard
              name="redraft"
              value="ai"
              checked={!replaceAll}
              onChange={() => {
                setReplaceAll(false);
              }}
              label={m.redraftAiOnly}
              description={mine > 0 ? m.redraftKeeps(mine) : m.redraftNothingToKeep}
            />
            <RadioCard
              name="redraft"
              value="all"
              checked={replaceAll}
              onChange={() => {
                setReplaceAll(true);
              }}
              label={section === 'all' ? m.redraftEverySection : m.redraftWholeSection}
              description={m.redraftRemoves(total, mine > 0)}
            />
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {m.cancel}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onRedraft(replaceAll);
            }}
          >
            <Icon icon={SparklesIcon} />
            {m.redraft}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** In place of a section while AI drafts it, as the prototype's violet skeleton. */
function DraftingSection({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-[9px] rounded-[10px] bg-ai-subtle px-4 py-3.5">
      <p
        role="status"
        className="flex items-center gap-2 text-[13.5px] font-medium text-ai-subtle-foreground"
      >
        <Spinner className="size-3.5 text-ai" />
        {m.draftingSection(label)}
      </p>
      <Skeleton className="h-2.5 w-[96%] from-ai/12 via-ai/5 to-ai/12" />
      <Skeleton className="h-2.5 w-[88%] from-ai/12 via-ai/5 to-ai/12" />
      <Skeleton className="h-2.5 w-[64%] from-ai/12 via-ai/5 to-ai/12" />
    </div>
  );
}

function DraftError({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <Alert
      variant="destructive"
      role="alert"
      className="items-center py-2.5 [&>svg]:top-1/2 [&>svg]:-translate-y-1/2"
    >
      <Icon icon={AlertCircleIcon} />
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-[200px] flex-1">{message}</span>
        <span className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <Icon icon={RefreshIcon} />
            {m.tryAgain}
          </Button>
          <Button variant="ghost" size="icon" aria-label={m.dismiss} onClick={onDismiss}>
            <Icon icon={Cancel01Icon} />
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
