import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  EmptyState,
  FigureChip,
  formatNumber,
  Icon,
  InfoTip,
  PatternCard,
  PatternCardSkeleton,
  useToast,
} from '@adili/ui';
import { AlertCircleIcon, ChartLineData01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';

import type { NationalReportResult } from '../../server/national-report.server';
import type {
  NarrativeParagraph,
  NationalReport,
  PatternCandidate,
} from '../../server/reporting/types';
import { highlightTarget } from '../highlight-target';
import {
  CardHeading,
  CardPager,
  COMMISSIONS_PER_PAGE,
  commissionRows,
  pageContaining,
  pageOf,
} from './aggregate-tables';
import { messages as m } from './messages';
import { appendParagraph } from './model';
import type { NcrExtensionContext, NcrExtensions } from './national-report-view';
import {
  candidateCard,
  citationText,
  fyLabel,
  citedCandidateIds,
  figureFormatter,
  figureTarget,
} from './patterns';

const NO_CANDIDATES: PatternCandidate[] = [];

/** Candidates per page of the panel, as the prototype pages them. */
export const PATTERNS_PER_PAGE = 6;

export type PatternCandidatesLoad = (
  fy: number,
) => Promise<NationalReportResult<PatternCandidate[]>>;

/** Where the year's candidates stand: hidden for a viewer the service refuses (403). */
export type PatternsState =
  | { status: 'loading' }
  | { status: 'loaded'; candidates: PatternCandidate[] }
  | { status: 'error' }
  | { status: 'hidden' };

export interface NcrPatternsOptions {
  fy: number;
  /** The year's report as the page has it; nothing is fetched before its first build. */
  report: NationalReport | null;
  load: PatternCandidatesLoad;
  /** The per-Commission table's page, and how to turn it, to show a cited figure's row. */
  page: number;
  onPageChange: (page: number) => void;
  onUnauthenticated: () => void;
}

/**
 * The NCR builder's spec 09b notable patterns (#331), as the page's extensions:
 * - `patterns`: the Notable patterns panel between the per-Commission table and the narrative,
 *   whose "Cite in findings" appends a findings paragraph citing the candidate's figures.
 * - `paragraphMeta`: the figure chips under each paragraph citing figures (`aggregateRefs`), which
 *   show their table row. These chips are the page's one rendering of a paragraph's figures; the
 *   page puts the AI-draft label before them. #341 adds its own items (its label transitions) by
 *   composing: render this `paragraphMeta` and its items beside it, rather than chips of its own.
 * The candidates are fetched once the report is built, and again after each rebuild.
 */
export function useNcrPatterns(options: NcrPatternsOptions): NcrExtensions {
  const { fy, report, load, onUnauthenticated } = options;
  const [attempt, setAttempt] = useState(0);
  const builtAt = report?.builtAt ?? null;
  // What came back, for which fetch: another year, a rebuild or a retry is loading until its own.
  const key = `${String(fy)}:${builtAt ?? ''}:${String(attempt)}`;
  const [answer, setAnswer] = useState<{ key: string; state: PatternsState } | null>(null);
  const state: PatternsState = answer?.key === key ? answer.state : { status: 'loading' };
  const signIn = useEffectEvent(() => {
    onUnauthenticated();
  });

  useEffect(() => {
    if (builtAt === null) return;
    let current = true;
    const settle = (next: PatternsState) => {
      if (current) setAnswer({ key, state: next });
    };
    void load(fy).then(
      (result) => {
        if (result.ok) settle({ status: 'loaded', candidates: result.data });
        else if (result.error.kind === 'unauthenticated') {
          if (current) signIn();
        } else if (result.error.kind === 'problem' && result.error.problem.status === 403) {
          settle({ status: 'hidden' });
        } else settle({ status: 'error' });
      },
      () => {
        settle({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [key, fy, builtAt, load]);

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  const showFigure = useShowFigure(options);
  const candidates = state.status === 'loaded' ? state.candidates : NO_CANDIDATES;

  // The panel and the paragraphs' figures read the same candidates.
  return {
    // Another year or a rebuild starts the panel over, on its first page.
    patterns: (context) => (
      <NotablePatterns
        key={`${String(fy)}:${builtAt ?? ''}`}
        state={state}
        context={context}
        onRetry={retry}
      />
    ),
    // Nothing for a paragraph citing no figure, so the editor leaves no gap under it.
    paragraphMeta: (paragraph, context) =>
      paragraph.aggregateRefs.length === 0 ? null : (
        <ParagraphMeta
          paragraph={paragraph}
          context={context}
          candidates={candidates}
          onShow={showFigure}
        />
      ),
  };
}

/** Shows a cited figure's row: its Commission's (turning the table's page) or a national total. */
function useShowFigure({ report, page, onPageChange }: NcrPatternsOptions) {
  const [pending, setPending] = useState<{ anchor: string; page: number } | null>(null);
  useEffect(() => {
    if (pending?.page !== page) return;
    // The page's rows render after the address changes; look for the row once they have.
    const frame = requestAnimationFrame(() => {
      highlightTarget(pending.anchor);
      setPending(null);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pending, page]);

  return useCallback(
    (aggregateKey: string) => {
      const target = report ? figureTarget(aggregateKey, report.aggregates.fy) : null;
      if (!target || !report) return;
      if ('national' in target) {
        highlightTarget(`ncr-total-${target.national}`);
        return;
      }
      const index = commissionRows(report.aggregates).findIndex(
        (row) => row.slug === target.commission,
      );
      if (index < 0) return;
      const rowPage = pageContaining(index, COMMISSIONS_PER_PAGE);
      if (rowPage !== page) onPageChange(rowPage);
      setPending({ anchor: `ncr-row-${target.commission}`, page: rowPage });
    },
    [report, page, onPageChange],
  );
}

function ParagraphMeta({
  paragraph,
  context,
  candidates,
  onShow,
}: {
  paragraph: NarrativeParagraph;
  context: NcrExtensionContext;
  candidates: readonly PatternCandidate[];
  onShow: (aggregateKey: string) => void;
}) {
  const format = useMemo(
    () => figureFormatter(context.report.aggregates, candidates),
    [context.report.aggregates, candidates],
  );
  return (
    <>
      {paragraph.aggregateRefs.map((key) => (
        <FigureChip
          key={key}
          aggregateKey={key}
          format={format}
          // A prior year's figure, or one with no row on the page, is plain text.
          onShow={figureTarget(key, context.report.aggregates.fy) ? onShow : undefined}
        />
      ))}
    </>
  );
}

/** What a retry found, for the panel's status region. */
function outcomeOf(state: PatternsState, count: number): string {
  if (state.status === 'error') return m.patternsFailed;
  if (state.status !== 'loaded') return '';
  return count === 0 ? m.noPatternsTitle : m.patternsCount(count);
}

/**
 * The Notable patterns panel (spec 09b FE-2, #331): the year's candidates as cards, six to a
 * page, each with its figures and, once the findings cite it, "Cited in findings". States:
 * loading, candidates, none, error with retry; nothing for a viewer the service refuses.
 */
export function NotablePatterns({
  state,
  context,
  onRetry,
}: {
  state: PatternsState;
  context: NcrExtensionContext;
  onRetry: () => void;
}) {
  const headingId = useId();
  const [page, setPage] = useState(1);
  const [retried, setRetried] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const { toast } = useToast();
  // The candidate just cited: its paragraph is focused once the editor shows it.
  const citing = useRef<string | null>(null);
  const findings = context.narrative.findings;
  useEffect(() => {
    const id = citing.current;
    if (!id) return;
    const paragraph = findings?.find((each) => each.candidateIds.includes(id));
    const field = paragraph
      ? document.querySelector<HTMLTextAreaElement>(
          `textarea[data-paragraph-id="${CSS.escape(paragraph.id)}"]`,
        )
      : null;
    if (!field) return;
    citing.current = null;
    field.scrollIntoView({ block: 'center' });
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [findings]);
  if (state.status === 'hidden') return null;
  const { report } = context;
  const candidates = state.status === 'loaded' ? state.candidates : [];
  const paged = pageOf(candidates, page, PATTERNS_PER_PAGE);
  const { shown } = paged;
  // The narrative being edited: a citation not saved yet counts.
  const cited = citedCandidateIds(Object.values(context.narrative).flat());

  const cite = (candidate: PatternCandidate) => {
    const card = candidateCard(candidate, report.aggregates);
    citing.current = candidate.id;
    context.editNarrative((value) =>
      appendParagraph(value, 'findings', {
        text: citationText(card),
        aggregateRefs: candidate.aggregateKeys,
        candidateIds: [candidate.id],
      }),
    );
    toast({ title: m.citedToast });
  };

  return (
    <Card
      id="ncr-patterns"
      role="region"
      aria-labelledby={headingId}
      aria-busy={state.status === 'loading' || undefined}
      className="@container scroll-mt-[76px] overflow-hidden p-0 sm:p-0"
    >
      <CardHeading
        id={headingId}
        ref={heading}
        extra={
          <>
            {state.status === 'loaded' && candidates.length > 0 ? (
              <Badge>
                <span aria-hidden="true">{formatNumber(candidates.length)}</span>
                <span className="sr-only">{m.patternsCount(candidates.length)}</span>
              </Badge>
            ) : null}
            <InfoTip label={m.patternsAbout} content={m.patternsTip} />
          </>
        }
      >
        {m.patternsTitle}
      </CardHeading>
      {/* What a retry found, said once it has: the panel's content changes out of sight. */}
      <p role="status" className="sr-only">
        {retried ? outcomeOf(state, candidates.length) : ''}
      </p>
      {state.status === 'error' ? (
        <div className="px-5 py-4">
          <Alert
            variant="destructive"
            className="items-center py-2.5 [&>svg]:top-1/2 [&>svg]:-translate-y-1/2"
          >
            <Icon icon={AlertCircleIcon} />
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>{m.patternsFailed}</span>
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setRetried(true);
                  // The Retry button goes with the alert; focus stays in the panel.
                  heading.current?.focus();
                  onRetry();
                }}
              >
                <Icon icon={RefreshIcon} />
                {m.retry}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : state.status === 'loaded' && candidates.length === 0 ? (
        <EmptyState
          icon={<Icon icon={ChartLineData01Icon} />}
          title={m.noPatternsTitle}
          description={m.noPatternsText(fyLabel(report.aggregates.fy))}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 px-5 pt-4 pb-5 @min-[720px]:grid-cols-2 @min-[1080px]:grid-cols-3">
            {state.status === 'loading'
              ? [0, 1, 2].map((each) => <PatternCardSkeleton key={each} />)
              : shown.map((candidate) => (
                  <PatternCard
                    key={candidate.id}
                    {...candidateCard(candidate, report.aggregates)}
                    cited={cited.has(candidate.id)}
                    onCite={
                      context.canEdit
                        ? () => {
                            cite(candidate);
                          }
                        : undefined
                    }
                  />
                ))}
          </div>
          <CardPager
            paged={paged}
            total={candidates.length}
            labels={{ pagination: m.patternsPagination, pageRows: m.patternsRows }}
            onPageChange={setPage}
          />
        </>
      )}
    </Card>
  );
}
