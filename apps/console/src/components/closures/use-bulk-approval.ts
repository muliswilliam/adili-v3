import type { BatchProgress, BatchReferences } from '@adili/ui';
import { useEffect, useRef, useState } from 'react';

import type { BulkApprovalResult, ClosureFilter, ClosureSummary } from '../../server/closures';
import type { ServiceError, ServiceResult } from '../../server/service-call';
import { closureFilterKey } from '../../closures/search';

/** Closures per chunk, as the review service approves them (review.yaml `approveBulkClosures`). */
export const CHUNK_SIZE = 100;

/** How often the counts are read while a run is under way, to show its chunks landing. */
export const PROGRESS_POLL_MS = 1_000;

export type BulkRun =
  | { status: 'idle' }
  | {
      status: 'running' | 'stopped' | 'done';
      /** The Idempotency-Key: the same one resumes a stopped run. */
      key: string;
      /** The filters the run approves: a key is bound to them, so Resume sends them again. */
      filter: ClosureFilter;
      /** The closures the run set out to approve. */
      total: number;
      /** Already approved when it started, so the counts read meanwhile give its progress. */
      baseline: number;
      /** Approved by this run so far. */
      approved: number;
      result: BulkApprovalResult | null;
      error: ServiceError | null;
    };

type Progress = Pick<
  Extract<BulkRun, { key: string }>,
  'filter' | 'total' | 'baseline' | 'approved'
>;

export interface BulkApproval {
  run: BulkRun;
  /** For `BatchSelector` while running, stopped or done. */
  progress: BatchProgress | undefined;
  references: BatchReferences | null;
  /**
   * Waiting closures of cases the supervisor once held, which the last finished run for these
   * filters left for another supervisor: the counts include them, but this supervisor cannot
   * approve them.
   */
  leftForOthers: number;
  /** Approve `total` closures of the current filters with a new key. */
  start: (summary: ClosureSummary, total: number) => void;
  /** Send the stopped run again with its key and filters: the service carries on under them. */
  resume: () => void;
  /** Back to the batch; the caller reads the counts again. */
  reset: () => void;
}

const IDLE: BulkRun = { status: 'idle' };

/**
 * One bulk approval at a time (spec 08 FE-4, S4), for the filters on screen. The approval is one
 * request that the review service works through in chunks of 100, each its own transaction, so
 * while it is under way the counts are read every second (one read at a time): the closures
 * approved since it started are its progress, and the chunks follow from them.
 *
 * When no answer comes in time (the console gives up after two minutes) but closures kept being
 * approved, the service is still at work: the request is sent again with the same key and
 * filters, which carries on under them (the review service shares a key's work between
 * requests). Another supervisor approving under the same filters meanwhile also moves the count,
 * so it can prompt such a re-send too; that one finds its work done or shares what is left. Any
 * other failure, or no answer and nothing approved since the last request, leaves the run
 * stopped at the chunk it reached, with the key kept for Resume.
 *
 * A key is bound to its filters (the service answers 422 to the key with others), so the run
 * keeps the filters it started with, and changing them after it stopped or finished starts
 * afresh. While it runs the filters are locked.
 */
export function useBulkApproval({
  filter,
  approve,
  readSummary,
}: {
  filter: ClosureFilter;
  approve: (
    idempotencyKey: string,
    filter: ClosureFilter,
  ) => Promise<ServiceResult<BulkApprovalResult>>;
  readSummary: (filter: ClosureFilter) => Promise<ServiceResult<ClosureSummary>>;
}): BulkApproval {
  const [run, setRun] = useState<BulkRun>(IDLE);
  const [left, setLeft] = useState({ key: '', count: 0 });
  const generation = useRef(0);
  // The latest reader, so a caller passing a new function each render does not restart the poll.
  const reader = useRef(readSummary);
  useEffect(() => {
    reader.current = readSummary;
  }, [readSummary]);

  // New filters drop a stopped or finished run: its key belongs to the old ones.
  const currentKey = closureFilterKey(filter);
  const [seenKey, setSeenKey] = useState(currentKey);
  if (seenKey !== currentKey) {
    setSeenKey(currentKey);
    if (run.status === 'stopped' || run.status === 'done') setRun(IDLE);
  }

  const running = run.status === 'running' ? run : null;
  const runningKey = running?.key ?? null;
  const runningFilter = running?.filter ?? null;
  const baseline = running?.baseline ?? 0;
  const total = running?.total ?? 0;
  useEffect(() => {
    if (runningKey === null || runningFilter === null) return undefined;
    let cancelled = false;
    let reading = false;
    const timer = setInterval(() => {
      // A slow read is not stacked on: the next tick after it answers reads again.
      if (reading) return;
      reading = true;
      void reader.current(runningFilter).then((read) => {
        reading = false;
        if (cancelled || !read.ok) return;
        const approved = Math.min(total, Math.max(0, read.data.approved - baseline));
        setRun((current) =>
          current.status === 'running' && current.key === runningKey && approved > current.approved
            ? { ...current, approved }
            : current,
        );
      });
    }, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runningKey, runningFilter, baseline, total]);

  function send(key: string, from: Progress) {
    const attempt = ++generation.current;
    setRun({ status: 'running', key, ...from, result: null, error: null });
    void approve(key, from.filter).then(async (outcome) => {
      if (generation.current !== attempt) return;
      if (outcome.ok) {
        setLeft({ key: closureFilterKey(from.filter), count: outcome.data.skipped });
        setRun({
          status: 'done',
          key,
          ...from,
          approved: outcome.data.approved,
          result: outcome.data,
          error: null,
        });
        return;
      }
      // What stayed approved: the counts as they are now.
      const read = await reader.current(from.filter);
      if (generation.current !== attempt) return;
      const counted = read.ok
        ? Math.max(0, Math.min(from.total, read.data.approved - from.baseline))
        : 0;
      if (noAnswer(outcome.error) && counted > from.approved) {
        send(key, { ...from, approved: counted });
        return;
      }
      setRun((current) => {
        const shown = current.status === 'idle' ? from.approved : current.approved;
        const approved = Math.min(from.total, Math.max(shown, counted));
        return { status: 'stopped', key, ...from, approved, result: null, error: outcome.error };
      });
    });
  }

  const progress = run.status === 'idle' ? undefined : progressOf(run);
  const references =
    run.status === 'done' && run.result?.firstReference && run.result.lastReference
      ? { first: run.result.firstReference, last: run.result.lastReference }
      : null;

  return {
    run,
    progress,
    references,
    leftForOthers: left.key === currentKey ? left.count : 0,
    start: (summary, count) => {
      send(crypto.randomUUID(), { filter, total: count, baseline: summary.approved, approved: 0 });
    },
    resume: () => {
      if (run.status !== 'stopped') return;
      const { filter: pinned, total: count, baseline: before, approved } = run;
      send(run.key, { filter: pinned, total: count, baseline: before, approved });
    },
    reset: () => {
      generation.current += 1;
      setRun(IDLE);
    },
  };
}

/** The service gave no answer (a timeout or a dropped connection), rather than refusing. */
function noAnswer(error: ServiceError): boolean {
  return error.kind === 'unavailable' && error.problemType === undefined;
}

function progressOf(run: Exclude<BulkRun, { status: 'idle' }>): BatchProgress {
  const chunks = run.result?.chunks ?? Math.ceil(run.total / CHUNK_SIZE);
  if (run.status === 'done') {
    return { chunk: chunks, chunks, approved: run.approved, total: run.approved };
  }
  const chunk = run.approved >= run.total ? chunks : Math.floor(run.approved / CHUNK_SIZE);
  return { chunk, chunks, approved: run.approved, total: run.total };
}
