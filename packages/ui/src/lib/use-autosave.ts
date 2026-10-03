import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * - `idle`: nothing changed yet.
 * - `saving`: a change is waiting for typing to pause, or a save is in flight.
 * - `saved`: everything changed so far is saved (`savedAt` says when).
 * - `retrying`: the last save failed; the latest value is sent again after a backoff.
 */
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'retrying';

export interface AutosaveOptions {
  /** How long typing must pause before a save. 1.5 s by default, as the declaration's. */
  delayMs?: number;
}

export interface Autosave<T> {
  status: AutosaveStatus;
  /** When the last save succeeded, or null before the first. */
  savedAt: Date | null;
  /** Records the latest value and saves it once typing pauses. */
  change: (value: T) => void;
  /** Saves a waiting value now, e.g. when the editor loses focus. */
  flush: () => void;
}

const MAX_RETRY_MS = 30_000;

/** Backoff after `failures` failed saves in a row: 1 s, 2 s, 4 s... up to 30 s. */
function retryDelay(failures: number): number {
  return Math.min(1_000 * 2 ** Math.max(failures - 1, 0), MAX_RETRY_MS);
}

interface Snapshot {
  status: AutosaveStatus;
  savedAt: Date | null;
}

type Timer = ReturnType<typeof setTimeout>;

/** The timers and the one save in flight, outside React. */
class AutosaveQueue<T> {
  private save: (value: T) => Promise<void> = () => Promise.resolve();
  private delayMs = 1_500;
  private snapshot: Snapshot = { status: 'idle', savedAt: null };
  private readonly listeners = new Set<() => void>();
  private pending: { value: T; ready: boolean } | null = null;
  /** The save in flight, settled either way. */
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  private debounce: Timer | null = null;
  private retry: Timer | null = null;
  private disposed = false;

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
    this.pending = { value, ready: false };
    this.clear('debounce');
    this.set({ status: this.failures > 0 ? 'retrying' : 'saving' });
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

  /** Stops the timers and sends a waiting value, e.g. when the page is left. */
  dispose() {
    this.disposed = true;
    this.clear('debounce');
    this.clear('retry');
    const waiting = this.pending;
    this.pending = null;
    if (!waiting) return;
    // After the save in flight, so the older value cannot land last. Nothing is left to show a
    // failure to, so it is not retried.
    const send = () => this.save(waiting.value).catch(() => undefined);
    if (this.inFlight) void this.inFlight.then(send);
    else void send();
  }

  /** Reverses `dispose`, for React's development remount. */
  revive() {
    this.disposed = false;
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
      () => {
        this.inFlight = null;
        this.failures += 1;
        // A newer edit replaces the value that failed.
        this.pending ??= { value: next.value, ready: true };
        if (this.disposed) return;
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
 * retried with backoff carrying the latest value. `save` resolves when saved and rejects when it
 * failed. A waiting value is sent when the component unmounts.
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
  const { status, savedAt } = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot,
  );
  return { status, savedAt, change: queue.change, flush: queue.flush };
}
