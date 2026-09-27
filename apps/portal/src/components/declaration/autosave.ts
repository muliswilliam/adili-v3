import type { SaveOutcome } from '../../server/declarations.server';
import type { SectionSaveResult } from '../../server/declarations/types';

/**
 * Autosave for a whole draft. The service's ETag covers the draft, not one section, so saves
 * are serialised: one PUT in flight at a time, each section's latest contents coalesced while
 * it waits, and every PUT carries the ETag the previous one returned.
 *
 * `autosaveReducer` is the pure state machine (S19: "conflict reducer shows reload on 412");
 * `AutosaveQueue` adds the timers (1.5 s debounce per section, exponential backoff up to 30 s)
 * and calls the server.
 */

export const DEBOUNCE_MS = 1_500;
export const MAX_RETRY_MS = 30_000;

/**
 * - `saved`: nothing waiting.
 * - `saving`: edits waiting or a PUT in flight.
 * - `retrying`: the last PUT failed on the network or the service; it will be tried again.
 * - `conflict`: 412, the draft changed elsewhere. Editing stops until a reload.
 * - `rejected`: 400, the service refused a section. Retrying won't help; the next edit will.
 *   The refused contents are kept and count as unsaved work until that section saves.
 */
export type AutosaveStatus = 'saved' | 'saving' | 'retrying' | 'conflict' | 'rejected';

export interface PendingSave {
  contents: unknown;
  /** The debounce has elapsed (or the section was flushed), so it can be sent. */
  ready: boolean;
}

export interface AutosaveState {
  etag: string;
  /** The draft version the ETag stands for; a read is only trusted when it is newer. */
  version: number;
  status: AutosaveStatus;
  /** Latest unsent contents per section, in the order they were first edited. */
  pending: Record<string, PendingSave>;
  inFlight: { key: string; contents: unknown } | null;
  /** Failed attempts in a row, for the backoff. */
  failures: number;
  /** The section, code and refused contents of the last 400, while status is `rejected`. */
  rejection: { key: string; code: string | null; contents: unknown } | null;
}

export type AutosaveEvent =
  | { type: 'edit'; key: string; contents: unknown }
  /** The debounce elapsed or the section was left. */
  | { type: 'ready'; key: string }
  /** Take the next ready section and put it in flight, if nothing is in flight. */
  | { type: 'send' }
  | { type: 'saved'; etag: string; version: number }
  | { type: 'failed' }
  | { type: 'conflict' }
  | { type: 'rejected'; code: string | null }
  /**
   * A fresh read of the draft, e.g. after an attachment was linked. Its ETag is taken only when
   * it is newer and nothing is waiting or in flight, so a slow read cannot undo a save.
   */
  | { type: 'adopt-etag'; etag: string; version: number }
  /**
   * The ETag a write made while saves were held left the draft at (see `whileHeld`). Edits that
   * waited during the write already build on it, so it is taken with them waiting, as long as
   * nothing is in flight and it is newer.
   */
  | { type: 'took-etag'; etag: string; version: number }
  | { type: 'reloaded'; etag: string; version: number };

export function initialAutosave(etag: string, version: number): AutosaveState {
  return {
    etag,
    version,
    status: 'saved',
    pending: {},
    inFlight: null,
    failures: 0,
    rejection: null,
  };
}

function idle(state: AutosaveState) {
  return state.inFlight === null && Object.keys(state.pending).length === 0;
}

/** True while a save is in flight or waiting to go. */
export function isSaving(state: AutosaveState): boolean {
  return !idle(state);
}

/**
 * True while a save is in flight or waiting, or a refused one has not been replaced, e.g. to
 * warn before the tab closes.
 */
export function hasUnsavedWork(state: AutosaveState): boolean {
  return !idle(state) || state.rejection !== null;
}

function settledStatus(state: AutosaveState): AutosaveStatus {
  if (state.rejection) return 'rejected';
  return idle(state) ? 'saved' : 'saving';
}

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  if (state.status === 'conflict' && event.type !== 'reloaded') return state;

  switch (event.type) {
    case 'edit': {
      const rejection = state.rejection?.key === event.key ? null : state.rejection;
      const next = {
        ...state,
        rejection,
        pending: { ...state.pending, [event.key]: { contents: event.contents, ready: false } },
      };
      return { ...next, status: state.failures > 0 ? 'retrying' : settledStatus(next) };
    }
    case 'ready': {
      const pending = state.pending[event.key];
      if (!pending || pending.ready) return state;
      return { ...state, pending: { ...state.pending, [event.key]: { ...pending, ready: true } } };
    }
    case 'send': {
      if (state.inFlight) return state;
      const key = Object.keys(state.pending).find((candidate) => state.pending[candidate]?.ready);
      const pending = key ? state.pending[key] : undefined;
      if (!key || !pending) return state;
      const rest = Object.fromEntries(
        Object.entries(state.pending).filter(([candidate]) => candidate !== key),
      );
      return {
        ...state,
        pending: rest,
        inFlight: { key, contents: pending.contents },
        status: state.failures > 0 ? 'retrying' : 'saving',
      };
    }
    case 'saved': {
      const next = {
        ...state,
        etag: event.etag,
        version: event.version,
        inFlight: null,
        failures: 0,
      };
      if (state.rejection?.key === state.inFlight?.key) next.rejection = null;
      return { ...next, status: settledStatus(next) };
    }
    case 'failed': {
      if (!state.inFlight) return state;
      const { key, contents } = state.inFlight;
      // A newer edit of the same section replaces the one that failed.
      const pending = state.pending[key]
        ? state.pending
        : { [key]: { contents, ready: true }, ...state.pending };
      return {
        ...state,
        pending,
        inFlight: null,
        failures: state.failures + 1,
        status: 'retrying',
      };
    }
    case 'conflict':
      // Unsaved edits cannot be applied on top of someone else's; the reload shows theirs.
      return { ...state, pending: {}, inFlight: null, failures: 0, status: 'conflict' };
    case 'rejected': {
      if (!state.inFlight) return state;
      const next = {
        ...state,
        inFlight: null,
        failures: 0,
        rejection: { key: state.inFlight.key, code: event.code, contents: state.inFlight.contents },
      };
      return { ...next, status: 'rejected' };
    }
    case 'adopt-etag':
      return idle(state) && event.version > state.version
        ? { ...state, etag: event.etag, version: event.version }
        : state;
    case 'took-etag':
      return state.inFlight === null && event.version > state.version
        ? { ...state, etag: event.etag, version: event.version }
        : state;
    case 'reloaded':
      return initialAutosave(event.etag, event.version);
  }
}

/** Backoff after `failures` failed attempts in a row: 1 s, 2 s, 4 s... up to 30 s. */
export function retryDelay(failures: number): number {
  return Math.min(1_000 * 2 ** Math.max(failures - 1, 0), MAX_RETRY_MS);
}

/**
 * A write to the draft outside the queue (linking or unlinking a document). It resolves to the
 * ETag and version the draft was left at, read back afterwards, or `etag: null` when unknown.
 */
export type HeldWrite<T> = () => Promise<{ value: T; etag: string | null; version: number }>;

export type HeldResult<T> = { status: 'done'; value: T } | { status: 'conflict' };

export type SaveSection = (key: string, contents: unknown, ifMatch: string) => Promise<SaveOutcome>;

export interface AutosaveQueueOptions {
  etag: string;
  version: number;
  save: SaveSection;
  /** A section was saved (with the contents sent); update its completeness, issues and list. */
  onSaved?: (key: string, result: SectionSaveResult, contents: unknown) => void;
  /** 404: the draft is gone (discarded elsewhere). */
  onMissing?: () => void;
}

/**
 * Runs the reducer against timers and the server. Subscribe for state changes (it works with
 * `useSyncExternalStore`).
 */
export class AutosaveQueue {
  private state: AutosaveState;
  private readonly listeners = new Set<() => void>();
  private readonly debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: AutosaveQueueOptions;
  private savedHandler: AutosaveQueueOptions['onSaved'];
  private holding = false;
  private holds: Promise<unknown> = Promise.resolve();

  constructor(options: AutosaveQueueOptions) {
    this.options = options;
    this.savedHandler = options.onSaved;
    this.state = initialAutosave(options.etag, options.version);
  }

  /** Replaces the handler called after each successful save. */
  setOnSaved(handler: AutosaveQueueOptions['onSaved']) {
    this.savedHandler = handler;
  }

  getState = (): AutosaveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Records a section's latest contents and saves them once typing pauses. */
  edit(key: string, contents: unknown) {
    if (this.state.status === 'conflict') return;
    this.dispatch({ type: 'edit', key, contents });
    this.clearDebounce(key);
    this.debounces.set(
      key,
      setTimeout(() => {
        this.debounces.delete(key);
        this.dispatch({ type: 'ready', key });
        this.pump();
      }, DEBOUNCE_MS),
    );
  }

  /** Sends a section's waiting edits now, e.g. when the declarant leaves the screen. */
  flush(key?: string) {
    const keys = key ? [key] : Object.keys(this.state.pending);
    for (const each of keys) {
      this.clearDebounce(each);
      this.dispatch({ type: 'ready', key: each });
    }
    this.pump();
  }

  adoptEtag(etag: string, version: number) {
    this.dispatch({ type: 'adopt-etag', etag, version });
  }

  /**
   * Runs a write the service makes to the draft outside this queue, e.g. linking a document,
   * which bumps the draft version without returning an ETag. Sends every waiting edit first (so
   * a new item exists before a document is linked to it), holds saves while the write runs,
   * then takes the ETag it read back before saving again. One write at a time; none after a
   * conflict.
   */
  whileHeld<T>(write: HeldWrite<T>): Promise<HeldResult<T>> {
    const run = this.holds.then(() => this.hold(write));
    this.holds = run.catch(() => undefined);
    return run;
  }

  private async hold<T>(write: HeldWrite<T>): Promise<HeldResult<T>> {
    this.flush();
    const settled = await this.until(
      (state) =>
        state.status === 'conflict' ||
        (state.inFlight === null &&
          this.retryTimer === null &&
          !Object.values(state.pending).some((pending) => pending.ready)),
    );
    if (settled.status === 'conflict') return { status: 'conflict' };
    this.holding = true;
    try {
      const { value, etag, version } = await write();
      if (etag !== null) this.dispatch({ type: 'took-etag', etag, version });
      return { status: 'done', value };
    } finally {
      this.holding = false;
      this.pump();
    }
  }

  /** Resolves once the state satisfies `done`, checking after every change. */
  private until(done: (state: AutosaveState) => boolean): Promise<AutosaveState> {
    return new Promise((resolve) => {
      if (done(this.state)) {
        resolve(this.state);
        return;
      }
      const unsubscribe = this.subscribe(() => {
        if (!done(this.state)) return;
        unsubscribe();
        resolve(this.state);
      });
    });
  }

  /** Starts over from a freshly loaded draft, e.g. after Reload on a conflict. */
  reset(etag: string, version: number) {
    for (const key of [...this.debounces.keys()]) this.clearDebounce(key);
    this.clearRetry();
    this.dispatch({ type: 'reloaded', etag, version });
  }

  dispose() {
    for (const key of [...this.debounces.keys()]) this.clearDebounce(key);
    this.clearRetry();
    this.listeners.clear();
  }

  private clearDebounce(key: string) {
    const timer = this.debounces.get(key);
    if (timer) clearTimeout(timer);
    this.debounces.delete(key);
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private dispatch(event: AutosaveEvent) {
    const next = autosaveReducer(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private pump() {
    if (this.holding) return; // a write outside the queue is running
    if (this.retryTimer) return; // the backoff decides when to try again
    const before = this.state.inFlight;
    this.dispatch({ type: 'send' });
    const sending = this.state.inFlight;
    if (!sending || sending === before) return;
    void this.send(sending.key, sending.contents, this.state.etag);
  }

  private async send(key: string, contents: unknown, ifMatch: string) {
    let outcome: SaveOutcome;
    try {
      outcome = await this.options.save(key, contents, ifMatch);
    } catch {
      outcome = { status: 'unavailable' };
    }
    switch (outcome.status) {
      case 'saved':
        this.dispatch({ type: 'saved', etag: outcome.etag, version: outcome.result.draftVersion });
        this.savedHandler?.(key, outcome.result, contents);
        break;
      case 'conflict':
        this.dispatch({ type: 'conflict' });
        return;
      case 'not-found':
        this.dispatch({ type: 'conflict' });
        this.options.onMissing?.();
        return;
      case 'rejected':
        this.dispatch({ type: 'rejected', code: outcome.code });
        break;
      case 'unavailable':
        this.dispatch({ type: 'failed' });
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.pump();
        }, retryDelay(this.state.failures));
        return;
    }
    this.pump();
  }
}
