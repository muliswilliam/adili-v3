import {
  AiLabel,
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  EmptyState,
  FigureChip,
  Icon,
  InfoTip,
  PatternCard,
  PatternCardSkeleton,
} from '@adili/ui';
import { AlertCircleIcon, ChartLineData01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useState } from 'react';

import type { NationalReportResult } from '../../server/national-report.server';
import type {
  NarrativeParagraph,
  NationalReport,
  PatternCandidate,
} from '../../server/reporting/types';
import { CursorPager } from '../cursor-pager';
import { highlightInDeclaration as highlight } from '../review/copilot/source-refs';
import { COMMISSIONS_PER_PAGE, commissionRows } from './aggregate-tables';
import { messages as m } from './messages';
import { fyLabel } from './model';
import type { NcrExtensionContext, NcrExtensions } from './national-report-view';
import { candidateCard, figureFormatter, figureTarget } from './patterns';

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
 * The NCR builder's spec 09b notable patterns (#331), as the page's extensions: the Notable
 * patterns panel between the per-Commission table and the narrative, and under each narrative
 * paragraph its AI label and the figures it cites, as chips that show their table row. The
 * candidates are fetched once the report is built, and again after each rebuild.
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
    patterns: (context) => <NotablePatterns state={state} context={context} onRetry={retry} />,
    // Nothing at all for a paragraph with no label or figure, so the editor leaves no gap under it.
    paragraphMeta: (paragraph, context) =>
      !paragraph.aiDraft && paragraph.aggregateRefs.length === 0 ? null : (
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
      highlight(pending.anchor);
      setPending(null);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pending, page]);

  return useCallback(
    (aggregateKey: string) => {
      const target = figureTarget(aggregateKey);
      if (!target || !report) return;
      if ('national' in target) {
        highlight(`ncr-total-${target.national}`);
        return;
      }
      const index = commissionRows(report.aggregates).findIndex(
        (row) => row.slug === target.commission,
      );
      if (index < 0) return;
      const rowPage = Math.floor(index / COMMISSIONS_PER_PAGE) + 1;
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
      {paragraph.aiDraft ? <AiLabel size="sm" text={m.aiDraft} /> : null}
      {paragraph.aggregateRefs.map((key) => (
        <FigureChip key={key} aggregateKey={key} format={format} onShow={onShow} />
      ))}
    </>
  );
}

/** The candidates the report's narrative cites, by id. */
function citedIn(report: NationalReport): Set<string> {
  return new Set(report.narrativeParagraphs.flatMap((paragraph) => paragraph.candidateIds));
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
  if (state.status === 'hidden') return null;
  const { report } = context;
  const candidates = state.status === 'loaded' ? state.candidates : [];
  const pages = Math.max(1, Math.ceil(candidates.length / PATTERNS_PER_PAGE));
  const current = Math.min(page, pages);
  const from = (current - 1) * PATTERNS_PER_PAGE;
  const shown = candidates.slice(from, from + PATTERNS_PER_PAGE);
  const cited = citedIn(report);

  return (
    <Card
      id="ncr-patterns"
      role="region"
      aria-labelledby={headingId}
      aria-busy={state.status === 'loading' || undefined}
      className="@container scroll-mt-[76px] overflow-hidden p-0 sm:p-0"
    >
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <h3 id={headingId} className="text-[15.5px] font-semibold tracking-[-0.01em]">
          {m.patternsTitle}
        </h3>
        {state.status === 'loaded' && candidates.length > 0 ? (
          <Badge aria-label={m.patternsCount(candidates.length)}>{candidates.length}</Badge>
        ) : null}
        <InfoTip label={m.patternsAbout} content={m.patternsTip} />
      </div>
      {state.status === 'error' ? (
        <div className="px-5 py-4">
          <Alert
            variant="destructive"
            className="items-center py-2.5 [&>svg]:top-1/2 [&>svg]:-translate-y-1/2"
          >
            <Icon icon={AlertCircleIcon} />
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>{m.patternsFailed}</span>
              <Button variant="secondary" size="sm" className="ml-auto" onClick={onRetry}>
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
                  />
                ))}
          </div>
          {pages > 1 ? (
            <CursorPager
              labels={{
                pagination: m.patternsPagination,
                pageRange: (start, end) => m.pageRange(start, end, candidates.length),
                pageRows: m.patternsRows,
                previousPage: m.previousPage,
                nextPage: m.nextPage,
              }}
              range={{ from: from + 1, to: from + shown.length }}
              rows={shown.length}
              hasPrevious={current > 1}
              hasNext={current < pages}
              onPrevious={() => {
                setPage(current - 1);
              }}
              onNext={() => {
                setPage(current + 1);
              }}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}
