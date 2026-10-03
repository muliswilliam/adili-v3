import type { BatchProgress, BatchReferences } from '@adili/ui';
import { useEffect, useRef, useState } from 'react';

import type { BulkApprovalResult, ClosureSummary } from '../../server/closures';
import type { ServiceError, ServiceResult } from '../../server/service-call';

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
      /** The closures the run set out to approve. */
      total: number;
      /** Already approved when it started, so the counts read meanwhile give its progress. */
      baseline: number;
      /** Approved by this run so far. */
      approved: number;
      result: BulkApprovalResult | null;
      error: ServiceError | null;
    };

export interface BulkApproval {
  run: BulkRun;
  /** For `BatchSelector` while running, stopped or done. */
  progress: BatchProgress | undefined;
  references: BatchReferences | null;
  /** Approve the `total` closures the counts show waiting, with a new key. */
  start: (summary: ClosureSummary) => void;
  /** Send the stopped run again with its key: the service carries on where its chunks got to. */
  resume: () => void;
  /** Back to the batch; the caller reads the counts again. */
  reset: () => void;
}

/**
 * One bulk approval at a time (spec 08 FE-4, S4). The approval is one request that the review
 * service works through in chunks of 100, each its own transaction, so while it is under way the
 * counts are read every second: the closures approved since it started are its progress, and the
 * chunks follow from them. When no answer comes in time (the console gives up after two minutes)
 * but chunks kept landing, the service is still at work: the request is sent again with the same
 * key, which carries on under it (the review service shares a key's work between requests). Any
 * other failure, or no answer and no chunk since the last request, leaves the run stopped at the
 * chunk it reached, with the key kept for Resume.
 */
export function useBulkApproval({
  approve,
  readSummary,
}: {
  approve: (idempotencyKey: string) => Promise<ServiceResult<BulkApprovalResult>>;
  readSummary: () => Promise<ServiceResult<ClosureSummary>>;
}): BulkApproval {
  const [run, setRun] = useState<BulkRun>({ status: 'idle' });
  const generation = useRef(0);
  // The latest reader, so a caller passing a new function each render does not restart the poll.
  const reader = useRef(readSummary);
  useEffect(() => {
    reader.current = readSummary;
  }, [readSummary]);

  const running = run.status === 'running' ? run : null;
  const runningKey = running?.key ?? null;
  const baseline = running?.baseline ?? 0;
  const total = running?.total ?? 0;
  useEffect(() => {
    if (runningKey === null) return undefined;
    let cancelled = false;
    const timer = setInterval(() => {
      void reader.current().then((read) => {
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
  }, [runningKey, baseline, total]);

  function send(key: string, from: { total: number; baseline: number; approved: number }) {
    const mine = ++generation.current;
    setRun({ status: 'running', key, ...from, result: null, error: null });
    void approve(key).then(async (outcome) => {
      if (generation.current !== mine) return;
      if (outcome.ok) {
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
      const read = await reader.current();
      if (generation.current !== mine) return;
      const counted = read.ok ? Math.min(from.total, read.data.approved - from.baseline) : 0;
      if (noAnswer(outcome.error) && counted > from.approved) {
        send(key, { ...from, approved: counted });
        return;
      }
      setRun((current) => {
        const sofar = current.status === 'idle' ? from.approved : current.approved;
        const approved = Math.min(from.total, Math.max(sofar, counted));
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
    start: (summary) => {
      send(crypto.randomUUID(), {
        total: summary.eligibleProposed,
        baseline: summary.approved,
        approved: 0,
      });
    },
    resume: () => {
      if (run.status !== 'stopped') return;
      send(run.key, { total: run.total, baseline: run.baseline, approved: run.approved });
    },
    reset: () => {
      generation.current += 1;
      setRun({ status: 'idle' });
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
