import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaveOutcome } from '../../server/declarations.server';
import {
  AutosaveQueue,
  autosaveReducer,
  type AutosaveEvent,
  type AutosaveState,
  DEBOUNCE_MS,
  hasUnsavedWork,
  initialAutosave,
  retryDelay,
} from './autosave';

function run(state: AutosaveState, ...events: AutosaveEvent[]) {
  return events.reduce(autosaveReducer, state);
}

function savedOutcome(etag: string, key = 'bio'): SaveOutcome {
  return {
    status: 'saved',
    etag,
    result: {
      key,
      completeness: 'incomplete',
      draftVersion: Number(etag.replaceAll('"', '')),
      issues: [],
      sectionsChanged: [],
    },
  };
}

function saved2(): AutosaveEvent {
  return { type: 'saved', etag: '"2"', version: 2 };
}

describe('autosave reducer (S19)', () => {
  const start = initialAutosave('"1"', 1);

  it('goes saving on an edit and saved once the PUT returns the new ETag', () => {
    const editing = run(start, { type: 'edit', key: 'bio', contents: { a: 1 } });
    expect(editing.status).toBe('saving');
    expect(hasUnsavedWork(editing)).toBe(true);

    const sending = run(editing, { type: 'ready', key: 'bio' }, { type: 'send' });
    expect(sending.inFlight).toEqual({ key: 'bio', contents: { a: 1 } });

    const done = run(sending, { type: 'saved', etag: '"2"', version: 2 });
    expect(done).toMatchObject({ status: 'saved', etag: '"2"', inFlight: null });
    expect(hasUnsavedWork(done)).toBe(false);
  });

  it('shows reload on 412 and ignores edits until reloaded', () => {
    const conflicted = run(
      start,
      { type: 'edit', key: 'bio', contents: { a: 1 } },
      { type: 'ready', key: 'bio' },
      { type: 'send' },
      { type: 'edit', key: 'household', contents: { b: 1 } },
      { type: 'conflict' },
    );
    expect(conflicted.status).toBe('conflict');
    expect(conflicted.pending).toEqual({});

    const ignored = run(conflicted, { type: 'edit', key: 'bio', contents: { a: 2 } });
    expect(ignored).toBe(conflicted);

    expect(run(conflicted, { type: 'reloaded', etag: '"9"', version: 9 })).toEqual(
      initialAutosave('"9"', 9),
    );
  });

  it('sends one section at a time and coalesces edits made while one is in flight', () => {
    const state = run(
      start,
      { type: 'edit', key: 'bio', contents: 1 },
      { type: 'ready', key: 'bio' },
      { type: 'send' },
      { type: 'edit', key: 'household', contents: 'a' },
      { type: 'ready', key: 'household' },
      { type: 'send' },
      { type: 'edit', key: 'household', contents: 'b' },
      { type: 'ready', key: 'household' },
    );
    expect(state.inFlight).toEqual({ key: 'bio', contents: 1 });
    expect(state.pending).toEqual({ household: { contents: 'b', ready: true } });

    const next = run(state, { type: 'saved', etag: '"2"', version: 2 }, { type: 'send' });
    expect(next).toMatchObject({ status: 'saving', inFlight: { key: 'household', contents: 'b' } });
  });

  it('does not send a section until its debounce elapses', () => {
    const state = run(start, { type: 'edit', key: 'bio', contents: 1 }, { type: 'send' });
    expect(state.inFlight).toBeNull();
  });

  it('retries a failed save, keeping a newer edit of the same section', () => {
    const inFlight = run(
      start,
      { type: 'edit', key: 'bio', contents: 1 },
      { type: 'ready', key: 'bio' },
      { type: 'send' },
    );
    const failed = run(inFlight, { type: 'failed' });
    expect(failed).toMatchObject({
      status: 'retrying',
      failures: 1,
      pending: { bio: { contents: 1, ready: true } },
    });

    const newer = run(inFlight, { type: 'edit', key: 'bio', contents: 2 }, { type: 'failed' });
    expect(newer.pending).toEqual({ bio: { contents: 2, ready: false } });

    const recovered = run(failed, { type: 'send' }, { type: 'saved', etag: '"2"', version: 2 });
    expect(recovered).toMatchObject({ status: 'saved', failures: 0 });
  });

  it('holds a 400 until that section is edited again', () => {
    const rejected = run(
      start,
      { type: 'edit', key: 'bio', contents: 1 },
      { type: 'ready', key: 'bio' },
      { type: 'send' },
      { type: 'rejected', code: 'identity-locked-field' },
    );
    // The refused contents are kept, and still count as unsaved work: not saved, sent again
    // with the next edit.
    expect(rejected).toMatchObject({
      status: 'retrying',
      rejection: { key: 'bio', code: 'identity-locked-field', contents: 1 },
    });
    expect(hasUnsavedWork(rejected)).toBe(true);
    // Flushing does not send them again: the service would refuse them again.
    expect(run(rejected, { type: 'ready', key: 'bio' }, { type: 'send' }).inFlight).toBeNull();

    const edited = run(rejected, { type: 'edit', key: 'bio', contents: 2 });
    expect(edited).toMatchObject({ status: 'saving', rejection: null });
    expect(
      hasUnsavedWork(run(edited, { type: 'ready', key: 'bio' }, { type: 'send' }, saved2())),
    ).toBe(false);
  });

  it('adopts a fresh ETag only when it is newer and nothing is waiting', () => {
    expect(run(start, { type: 'adopt-etag', etag: '"5"', version: 5 }).etag).toBe('"5"');
    const busy = run(start, { type: 'edit', key: 'bio', contents: 1 });
    expect(run(busy, { type: 'adopt-etag', etag: '"5"', version: 5 }).etag).toBe('"1"');
    const saved = run(
      busy,
      { type: 'ready', key: 'bio' },
      { type: 'send' },
      { type: 'saved', etag: '"6"', version: 6 },
    );
    expect(run(saved, { type: 'adopt-etag', etag: '"5"', version: 5 }).etag).toBe('"6"');
  });

  it('takes the ETag of a write made while saves were held, even with edits waiting', () => {
    const waiting = run(start, { type: 'edit', key: 'bio', contents: 1 });
    expect(run(waiting, { type: 'took-etag', etag: '"5"', version: 5 }).etag).toBe('"5"');
    const sending = run(waiting, { type: 'ready', key: 'bio' }, { type: 'send' });
    expect(run(sending, { type: 'took-etag', etag: '"5"', version: 5 }).etag).toBe('"1"');
    expect(run(start, { type: 'took-etag', etag: '"0"', version: 0 }).etag).toBe('"1"');
  });

  it('backs off exponentially up to 30 seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });
});

describe('AutosaveQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces 1.5 s per section and sends the whole section with If-Match', async () => {
    const save = vi
      .fn<(key: string, contents: unknown, ifMatch: string) => Promise<SaveOutcome>>()
      .mockResolvedValue(savedOutcome('"2"'));
    const onSaved = vi.fn();
    const queue = new AutosaveQueue({ etag: '"1"', version: 1, save, onSaved });

    queue.edit('bio', { place: 'N' });
    queue.edit('bio', { place: 'Nyeri' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith('bio', { place: 'Nyeri' }, '"1"');
    expect(queue.getState()).toMatchObject({ status: 'saved', etag: '"2"' });
    expect(onSaved).toHaveBeenCalledWith('bio', expect.objectContaining({ key: 'bio' }), {
      place: 'Nyeri',
    });
  });

  it('serialises saves and chains the ETag from one to the next', async () => {
    let finish: (outcome: SaveOutcome) => void = () => undefined;
    const save = vi
      .fn<(key: string, contents: unknown, ifMatch: string) => Promise<SaveOutcome>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(savedOutcome('"3"', 'household'));
    const queue = new AutosaveQueue({ etag: '"1"', version: 1, save });

    queue.edit('bio', 1);
    queue.flush('bio');
    queue.edit('household', 'a');
    queue.flush('household');
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);

    finish(savedOutcome('"2"'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenLastCalledWith('household', 'a', '"2"');
    expect(queue.getState()).toMatchObject({ status: 'saved', etag: '"3"' });
  });

  it('retries with backoff after a failure', async () => {
    const save = vi
      .fn<(key: string, contents: unknown, ifMatch: string) => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ status: 'unavailable' })
      .mockResolvedValueOnce({ status: 'unavailable' })
      .mockResolvedValue(savedOutcome('"2"'));
    const queue = new AutosaveQueue({ etag: '"1"', version: 1, save });

    queue.edit('bio', 1);
    queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getState().status).toBe('retrying');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(queue.getState().status).toBe('saved');
  });

  it('stops on a conflict and resumes after a reset', async () => {
    const save = vi
      .fn<(key: string, contents: unknown, ifMatch: string) => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ status: 'conflict' })
      .mockResolvedValue(savedOutcome('"8"'));
    const queue = new AutosaveQueue({ etag: '"1"', version: 1, save });

    queue.edit('bio', 1);
    queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getState().status).toBe('conflict');

    queue.edit('bio', 2);
    queue.flush();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);

    queue.reset('"7"', 7);
    queue.edit('bio', 3);
    queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenLastCalledWith('bio', 3, '"7"');
  });

  describe('whileHeld (writes outside the queue, e.g. linking a document)', () => {
    function deferred<T>() {
      let resolve: (value: T) => void = () => undefined;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    it('sends waiting edits first, holds saves during the write, then saves with its ETag', async () => {
      const save = vi
        .fn<(key: string, contents: unknown, ifMatch: string) => Promise<SaveOutcome>>()
        .mockResolvedValueOnce(savedOutcome('"2"'))
        .mockResolvedValue(savedOutcome('"4"'));
      const queue = new AutosaveQueue({ etag: '"1"', version: 1, save });
      const write = deferred<{ value: string; etag: string; version: number }>();
      const task = vi.fn<(etag: string) => typeof write.promise>(() => write.promise);

      queue.edit('statement:officer', { assets: ['new item'] });
      const held = queue.whileHeld(task);
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledWith('statement:officer', { assets: ['new item'] }, '"1"');
      // The write gets the ETag the waiting edits left, for its If-Match.
      expect(task).toHaveBeenCalledExactlyOnceWith('"2"');

      // Typing during the write waits for it.
      queue.edit('statement:officer', { assets: ['typed'] });
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect(save).toHaveBeenCalledTimes(1);

      write.resolve({ value: 'linked', etag: '"3"', version: 3 });
      expect(await held).toEqual({ status: 'done', value: 'linked' });
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenLastCalledWith('statement:officer', { assets: ['typed'] }, '"3"');
    });

    it('runs one write at a time', async () => {
      const queue = new AutosaveQueue({ etag: '"1"', version: 1, save: vi.fn() });
      const first = deferred<{ value: number; etag: null; version: number }>();
      const second = vi.fn(() => Promise.resolve({ value: 2, etag: null, version: 0 }));

      const one = queue.whileHeld(() => first.promise);
      const two = queue.whileHeld(second);
      await vi.advanceTimersByTimeAsync(0);
      expect(second).not.toHaveBeenCalled();

      first.resolve({ value: 1, etag: null, version: 0 });
      expect(await one).toEqual({ status: 'done', value: 1 });
      expect(await two).toEqual({ status: 'done', value: 2 });
    });

    it('does not write after a conflict', async () => {
      const save = vi.fn(() => Promise.resolve<SaveOutcome>({ status: 'conflict' }));
      const queue = new AutosaveQueue({ etag: '"1"', version: 1, save });
      const task = vi.fn(() => Promise.resolve({ value: 1, etag: null, version: 0 }));

      queue.edit('bio', 1);
      const held = queue.whileHeld(task);
      await vi.advanceTimersByTimeAsync(0);
      expect(await held).toEqual({ status: 'conflict' });
      expect(task).not.toHaveBeenCalled();
    });

    it('releases the hold when the write throws', async () => {
      const save = vi.fn(() => Promise.resolve(savedOutcome('"2"')));
      const queue = new AutosaveQueue({ etag: '"1"', version: 1, save });

      await expect(queue.whileHeld(() => Promise.reject(new Error('offline')))).rejects.toThrow(
        'offline',
      );
      queue.edit('bio', 1);
      queue.flush();
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledWith('bio', 1, '"1"');
    });
  });
});
