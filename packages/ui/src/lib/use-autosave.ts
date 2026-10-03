import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * - `idle`: nothing changed yet (or since `reset`).
 * - `saving`: a change is waiting for typing to pause, or a save is in flight.
 * - `saved`: everything changed so far is saved (`savedAt` says when).
 * - `retrying`: the last save failed for a passing reason (network, 5xx); the latest value is
 *   sent again after a backoff.
 * - `error`: the service refused the save for good (`AutosaveFailure` of kind `error`, e.g. 400,
 *   403, or a report approved meanwhile). Not retried; the next edit is saved as usual.
 * - `conflict`: someone else changed it (`AutosaveFailure` of kind `conflict`, e.g. 412). Edits
 *   are no longer saved until `reset`, e.g. after a reload.
 */
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'retrying' | 'error' | 'conflict';

/**
 * Reject a save with this to stop retrying: `error` for a refusal the same value would meet
 * again, `conflict` for an edit made elsewhere. Any other rejection is retried with backoff.
 * `message` is for the caller to show; the hook only keeps it in `failure`.
 */
export class AutosaveFailure extends Error {
  readonly kind: 'error' | 'conflict';

  constructor(kind: 'error' | 'conflict', message?: string, options?: ErrorOptions) {
    super(message ?? kind, options);
    this.name = 'AutosaveFailure';
    this.kind = kind;
  }
}

export interface AutosaveOptions {
  /** How long typing must pause before a save. 1.5 s by default, as the declaration's. */
  delayMs?: number;
}

/**
 * What a component showing the save needs: the status, when it last saved, why it stopped, and
 * `flush` for when its fields lose focus. `NarrativeEditor` and `FormMSection` take this.
 */
export interface AutosaveState {
  status: AutosaveStatus;
  /** When the last save succeeded, or null before the first. */
  savedAt: Date | null;
  /** The refusal behind `error` or `conflict`; null otherwise. */
  failure: AutosaveFailure | null;
  /** Saves a waiting value now, e.g. when a field loses focus. */
  flush: () => void;
}

export interface Autosave<T> extends AutosaveState {
  /** Records the latest value and saves it once typing pauses. Ignored after a conflict. */
  change: (value: T) => void;
  /** Drops anything waiting and starts over from `idle`, e.g. after reloading on a conflict. */
  reset: () => void;
}

const MAX_RETRY_MS = 30_000;

/** Backoff after `failures` failed saves in a row: 1 s, 2 s, 4 s... up to 30 s. */
function retryDelay(failures: number): number {
  return Math.min(1_000 * 2 ** Math.max(failures - 1, 0), MAX_RETRY_MS);
}

interface Snapshot {
  status: AutosaveStatus;
  savedAt: Date | null;
  failure: AutosaveFailure | null;
}

type Timer = ReturnType<typeof setTimeout>;

/** The timers and the one save in flight, outside React. */
class AutosaveQueue<T> {
  private save: (value: T) => Promise<void> = () => Promise.resolve();
  private delayMs = 1_500;
  private snapshot: Snapshot = { status: 'idle', savedAt: null, failure: null };
  private readonly listeners = new Set<() => void>();
  private pending: { value: T; ready: boolean } | null = null;
  /** The save in flight, settled either way. */
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  private debounce: Timer | null = null;
  private retry: Timer | null = null;
  private disposed = false;
  /** Set when `dispose` queued the waiting value behind the save in flight. */
  private sendOnSettle = false;

  /** Takes the caller's latest save function and delay. */
  configure(save: (value: T) => Promise<void>, delayMs: number) {
    this.save = save;
    this.delayMs = delayMs;
  }

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  change = (value: T) => {
    if (this.snapshot.status === 'conflict') return;
    this.pending = { value, ready: false };
    this.clear('debounce');
    this.set({ status: this.failures > 0 ? 'retrying' : 'saving', failure: null });
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.markReady();
      this.pump();
    }, this.delayMs);
  };

  flush = () => {
    if (!this.pending) return;
    this.clear('debounce');
    this.clear('retry');
    this.markReady();
    this.pump();
  };

  reset = () => {
    this.clear('debounce');
    this.clear('retry');
    this.pending = null;
    this.failures = 0;
    this.set({ status: 'idle', failure: null });
  };

  /**
   * Stops the timers and sends a waiting value, e.g. when the page is left: after the save in
   * flight, so the older value cannot land last. Nothing is left to show a failure to, so a
   * value that fails now is not retried.
   */
  dispose() {
    this.disposed = true;
    this.clear('debounce');
    this.clear('retry');
    const waiting = this.pending;
    this.pending = null;
    if (!waiting || this.snapshot.status === 'conflict') return;
    const send = () => this.save(waiting.value).catch(() => undefined);
    if (this.inFlight) {
      this.sendOnSettle = true;
      void this.inFlight.then(send);
    } else void send();
  }

  /** Reverses `dispose`, for React's development remount. */
  revive() {
    this.disposed = false;
    this.sendOnSettle = false;
  }

  private markReady() {
    if (this.pending) this.pending.ready = true;
  }

  private clear(timer: 'debounce' | 'retry') {
    const handle = this[timer];
    if (handle) clearTimeout(handle);
    this[timer] = null;
  }

  private set(next: Partial<Snapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  private pump() {
    const next = this.pending;
    if (this.disposed || this.inFlight || this.retry || !next?.ready) return;
    this.pending = null;
    this.set({ status: this.failures > 0 ? 'retrying' : 'saving' });
    this.inFlight = this.save(next.value).then(
      () => {
        this.inFlight = null;
        this.failures = 0;
        this.set({ savedAt: new Date(), status: this.pending ? 'saving' : 'saved' });
        this.pump();
      },
      (error: unknown) => {
        this.inFlight = null;
        if (error instanceof AutosaveFailure) {
          this.failures = 0;
          this.clear('debounce');
          // A refused value is not sent again; a newer edit waiting for its pause still is.
          if (error.kind === 'conflict') this.pending = null;
          this.set(
            this.pending
              ? { status: 'saving', failure: null }
              : { status: error.kind, failure: error },
          );
          if (this.pending) {
            this.markReady();
            this.pump();
          }
          return;
        }
        this.failures += 1;
        if (this.disposed) {
          // Leaving the page: one more try with the failed value, unless a newer one is queued.
          if (!this.sendOnSettle) this.save(next.value).catch(() => undefined);
          return;
        }
        // A newer edit replaces the value that failed.
        this.pending ??= { value: next.value, ready: true };
        this.set({ status: 'retrying' });
        this.retry = setTimeout(() => {
          this.retry = null;
          this.markReady();
          this.pump();
        }, retryDelay(this.failures));
      },
    );
  }
}

/**
 * Saves a whole value (a narrative, a section's remarks) as it is edited: debounced, one save in
 * flight at a time with the edits made meanwhile coalesced into the next, and a failed save
 * retried with backoff carrying the latest value, unless `save` rejects with an
 * `AutosaveFailure`, which stops it (`error` or `conflict`). A waiting value is sent when the
 * component unmounts. Pass the result to `NarrativeEditor` or `FormMSection` as `autosave`.
 */
export function useAutosave<T>(
  save: (value: T) => Promise<void>,
  { delayMs = 1_500 }: AutosaveOptions = {},
): Autosave<T> {
  const [queue] = useState(() => new AutosaveQueue<T>());
  useEffect(() => {
    queue.configure(save, delayMs);
  }, [queue, save, delayMs]);
  useEffect(() => {
    queue.revive();
    return () => {
      queue.dispose();
    };
  }, [queue]);
  const { status, savedAt, failure } = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot,
  );
  return {
    status,
    savedAt,
    failure,
    change: queue.change,
    flush: queue.flush,
    reset: queue.reset,
  };
}
