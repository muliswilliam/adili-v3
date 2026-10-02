import type { Feedback } from '@adili/ui';
import { useEffect, useEffectEvent, useState } from 'react';

import type { Copilot } from '../../../server/copilot.server';
import type { ServiceResult } from '../../../server/service-call';
import { messages as t } from './messages';

/** What the hook calls: the server functions in the app, fakes in tests. */
export interface CopilotApi {
  read: (caseId: string) => Promise<ServiceResult<Copilot>>;
  refresh: (caseId: string) => Promise<ServiceResult<Copilot>>;
  rate: (jobId: string, feedback: Feedback) => Promise<ServiceResult<null>>;
}

/** Waits between polls while the copilot is pending or stale: quick at first, then every 15 s. */
export const POLL_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 13_000, 15_000] as const;

/** Polling stops this long after it started; "Check again" starts it over. */
export const POLL_STOP_AFTER_MS = 120_000;

export const pollDelay = (attempt: number): number =>
  POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)] ?? 15_000;

/** The copilot is being produced: the panel waits and polls. */
export const isBusy = (copilot: Copilot | null): boolean =>
  copilot?.status === 'pending' || copilot?.status === 'stale';

export interface CaseCopilot {
  /** The copilot as last read; null until the first answer. */
  copilot: Copilot | null;
  /** Why the first read gave nothing: `retry` tries again. Null once anything was read. */
  error: 'unavailable' | 'unauthenticated' | 'not-found' | null;
  /** Polling stopped after two minutes while still pending or stale. */
  stopped: boolean;
  /** A refresh is on its way to the review service. */
  refreshing: boolean;
  /** Reads again: after a failed first read, or "Check again" once polling stopped. */
  retry: () => void;
  /** Re-requests the summary and explanations; resolves to an error to show, or null. */
  refresh: () => Promise<string | null>;
  /** The caller's rating of an output (a job), or null. */
  ratingOf: (jobId: string | null) => Feedback | null;
  /** Saves a rating; rejects when it was not saved, so the control keeps the form open. */
  rate: (jobId: string, feedback: Feedback) => Promise<void>;
}

const UNAVAILABLE = { ok: false, error: { kind: 'unavailable', detail: null } } as const;

/**
 * A server function's answer, or "unavailable" when the call itself failed (the network, or the
 * server function threw): the panel then says so instead of waiting forever.
 */
async function settled<T>(call: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await call();
  } catch {
    return UNAVAILABLE;
  }
}

function refreshError(result: Exclude<ServiceResult<Copilot>, { ok: true }>): string {
  const { error } = result;
  if (error.kind === 'unauthenticated') return t.sessionEnded;
  if (error.kind === 'problem' && error.problem.status === 403) return t.refreshFailed.forbidden;
  if (error.kind === 'problem' && error.problem.status === 409) return t.refreshFailed.pending;
  return t.refreshFailed.unavailable;
}

/**
 * The Copilot of a review case: read once, then, while it is pending or stale, read again after
 * 2, 3, 5, 8 and 13 seconds and every 15 seconds after that, for up to two minutes. Polls are
 * sequential, so a slow review service is never asked twice at once; a failed poll is retried
 * on the same schedule. Refresh and ratings go through `api`.
 */
export function useCaseCopilot(caseId: string, api: CopilotApi, initial?: Copilot): CaseCopilot {
  const [copilot, setCopilot] = useState<Copilot | null>(initial ?? null);
  const [error, setError] = useState<CaseCopilot['error']>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped to read again after a failed first read.
  const [loadRound, setLoadRound] = useState(0);
  // Bumped to poll again for two minutes (after a refresh or "Check again").
  const [pollRound, setPollRound] = useState(0);
  // The polling round that ran out of time.
  const [stoppedRound, setStoppedRound] = useState<number | null>(null);
  // Ratings saved in this session, with their reason and note (the view carries ratings only).
  const [saved, setSaved] = useState<Record<string, Feedback>>({});
  const read = useEffectEvent((id: string) => settled(() => api.read(id)));
  const busy = isBusy(copilot);
  const skipFirstRead = initial !== undefined;

  // The first read (unless the caller passed one in), and each retry after it failed.
  useEffect(() => {
    if (loadRound === 0 && skipFirstRead) return;
    let cancelled = false;
    void read(caseId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setCopilot(result.data);
        setError(null);
      } else if (result.error.kind === 'unauthenticated') {
        setError('unauthenticated');
      } else if (
        result.error.kind === 'problem' &&
        (result.error.problem.status === 404 || result.error.problem.status === 403)
      ) {
        setError('not-found');
      } else {
        setError('unavailable');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [caseId, loadRound, skipFirstRead]);

  // Polling while pending or stale.
  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let attempt = 0;

    const schedule = () => {
      const delay = pollDelay(attempt);
      attempt += 1;
      const left = POLL_STOP_AFTER_MS - (Date.now() - startedAt);
      if (delay > left) {
        timer = setTimeout(
          () => {
            setStoppedRound(pollRound);
          },
          Math.max(0, left),
        );
        return;
      }
      timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      const result = await read(caseId);
      if (cancelled) return;
      if (result.ok) {
        setCopilot(result.data);
        if (!isBusy(result.data)) return;
      } else if (result.error.kind === 'unauthenticated') {
        // The panel keeps what it showed; a reload signs in again.
        return;
      }
      schedule();
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [caseId, busy, pollRound]);

  const fromView = (jobId: string): Feedback | null => {
    const rating = copilot?.feedback.find((each) => each.jobId === jobId)?.rating;
    return rating ? { rating, reason: null, note: null } : null;
  };

  return {
    copilot,
    error: copilot ? null : error,
    stopped: busy && stoppedRound === pollRound,
    refreshing,
    retry: () => {
      if (!copilot) {
        setError(null);
        setLoadRound((value) => value + 1);
        return;
      }
      // "Check again": read now, then poll again for two minutes (also when this read fails).
      void settled(() => api.read(caseId)).then((result) => {
        if (result.ok) setCopilot(result.data);
        setPollRound((value) => value + 1);
      });
    },
    refresh: async () => {
      setRefreshing(true);
      const result = await settled(() => api.refresh(caseId));
      setRefreshing(false);
      if (result.ok) {
        setCopilot(result.data);
        setPollRound((value) => value + 1);
        return null;
      }
      // 409: someone else refreshed it, or AI was turned off; read where it stands.
      if (result.error.kind === 'problem' && result.error.problem.status === 409) {
        const now = await settled(() => api.read(caseId));
        if (now.ok) setCopilot(now.data);
      }
      return refreshError(result);
    },
    ratingOf: (jobId) => (jobId ? (saved[jobId] ?? fromView(jobId)) : null),
    rate: async (jobId, feedback) => {
      const result = await settled(() => api.rate(jobId, feedback));
      if (!result.ok) throw new Error('Rating not saved');
      setSaved((current) => ({ ...current, [jobId]: feedback }));
    },
  };
}
