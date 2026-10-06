import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import type { NationalReportLoad, NationalReportResult } from '../../server/national-report.server';
import type { NationalAggregates, NationalReport } from '../../server/reporting/types';
import { useRefreshOnFocus } from '../use-refresh-on-focus';
import { earlierYearsCited } from './patterns';

const NO_YEARS: number[] = [];

/** A year's report the service will not give: not built (404) or not for this viewer (403). */
const REFUSED = new Set([403, 404]);

export interface EarlierAggregatesOptions {
  /** The year on show, by its start year. */
  fy: number;
  /** The year's report as the page has it, whose paragraphs cite the earlier years. */
  report: NationalReport | null;
  /** Reads a year's report (`getNationalReport`). */
  loadReport: NationalReportLoad;
  onUnauthenticated: () => void;
}

/**
 * The aggregates of the earlier years the report's paragraphs cite, for their figures' chips.
 * Each year's report is read when a paragraph first cites it. A year the service will not give
 * (404 not built, 403) is not asked for again. A read that failed otherwise (network, 5xx, 429
 * and the like) is tried again each time the window regains focus, until it answers. Meanwhile
 * the year's figures resolve from the candidates or not at all. The first answer saying the
 * session ended sends the viewer to sign in, once, and no year is asked for after it.
 */
export function useEarlierAggregates({
  fy,
  report,
  loadReport,
  onUnauthenticated,
}: EarlierAggregatesOptions): NationalAggregates[] {
  const cited = useMemo(
    () => (report ? earlierYearsCited(report.narrativeParagraphs, fy) : NO_YEARS),
    [report, fy],
  );
  const [read, setRead] = useState<ReadonlyMap<number, NationalAggregates>>(() => new Map());
  // Bumped on focus while a read has failed, to try those years again.
  const [attempt, setAttempt] = useState(0);
  // Years not to ask for on this pass: being read, refused for good, or failed until focus.
  const reading = useRef(new Set<number>());
  const refused = useRef(new Set<number>());
  const failed = useRef(new Set<number>());
  const signedOut = useRef(false);
  // Answers land after later passes of the reading effect (each year read starts one), so they
  // are silenced only when the page goes, not by the pass that asked: a flag per pass would drop
  // live answers, and StrictMode's extra pass would drop the first.
  const mounted = useRef(false);
  const signIn = useEffectEvent(() => {
    if (signedOut.current) return;
    signedOut.current = true;
    onUnauthenticated();
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useRefreshOnFocus(
    useCallback(() => {
      if (failed.current.size === 0 || signedOut.current) return;
      failed.current.clear();
      setAttempt((count) => count + 1);
    }, []),
  );

  useEffect(() => {
    if (signedOut.current) return;
    for (const year of cited) {
      const skip =
        read.has(year) ||
        reading.current.has(year) ||
        refused.current.has(year) ||
        failed.current.has(year);
      if (skip) continue;
      reading.current.add(year);
      const settle = (result: NationalReportResult<NationalReport> | null) => {
        reading.current.delete(year);
        if (result?.ok) {
          if (mounted.current) setRead((years) => new Map(years).set(year, result.data.aggregates));
          return;
        }
        const error = result?.error;
        if (error?.kind === 'unauthenticated') signIn();
        else if (error?.kind === 'problem' && REFUSED.has(error.problem.status)) {
          refused.current.add(year);
        } else failed.current.add(year);
      };
      void loadReport(year).then(settle, () => {
        settle(null);
      });
    }
  }, [cited, read, attempt, loadReport]);

  return useMemo(() => cited.flatMap((year) => read.get(year) ?? []), [cited, read]);
}
