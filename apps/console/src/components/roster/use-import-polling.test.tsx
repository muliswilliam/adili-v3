// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirectoryResult, RosterImport } from '../../server/directory/client';
import { RECONNECTING_AFTER, useImportPolling } from './use-import-polling';

const importId = '0199a0b4-0000-7000-8000-0000000000aa';

const snapshot = (overrides: Partial<RosterImport>): RosterImport => ({
  id: importId,
  channel: 'file',
  declaredComplete: false,
  state: 'processing',
  fileName: 'roster.csv',
  format: 'csv',
  totalRows: 3,
  processedRows: 0,
  counts: null,
  mapping: null,
  failure: null,
  startedBy: { kind: 'user', id: 'user-1' },
  startedAt: '2026-09-26T07:40:00Z',
  completedAt: null,
  ...overrides,
});

const ok = (data: RosterImport): DirectoryResult<RosterImport> => ({ ok: true, data });
const down: DirectoryResult<RosterImport> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

/** Answers the reads in order, repeating the last one. */
function reads(...answers: DirectoryResult<RosterImport>[]) {
  let index = 0;
  return vi.fn(() => {
    const answer = answers[Math.min(index, answers.length - 1)] ?? down;
    index += 1;
    return Promise.resolve(answer);
  });
}

/** Lets pending promises settle, then moves the clock on. */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useImportPolling', () => {
  it('reads now, then every 2 seconds until the import completes', async () => {
    const read = reads(
      ok(snapshot({ processedRows: 1 })),
      ok(snapshot({ processedRows: 2 })),
      ok(snapshot({ state: 'completed', processedRows: 3 })),
    );
    const onEnded = vi.fn();
    const { result } = renderHook(() =>
      useImportPolling(importId, { read, onEnded, onUnauthenticated: vi.fn() }),
    );
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.imp?.processedRows).toBe(1);

    await tick(1999);
    expect(read).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(result.current.imp?.processedRows).toBe(2);

    await tick(2000);
    expect(result.current.imp?.state).toBe('completed');
    expect(onEnded).toHaveBeenCalledTimes(1);

    await tick(10_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('keeps polling through failures after a good read, saying so after a few', async () => {
    const read = reads(ok(snapshot({ processedRows: 1 })), down);
    const { result } = renderHook(() =>
      useImportPolling(importId, { read, onEnded: vi.fn(), onUnauthenticated: vi.fn() }),
    );
    await tick();
    for (let failure = 1; failure < RECONNECTING_AFTER; failure += 1) {
      await tick(2000);
      expect(result.current.reconnecting).toBe(false);
    }
    await tick(2000);
    expect(result.current.reconnecting).toBe(true);
    // The last good read stays on screen.
    expect(result.current.imp?.processedRows).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('stops with an error when the first read fails, and retries on request', async () => {
    const read = reads(down, ok(snapshot({ processedRows: 2 })));
    const { result } = renderHook(() =>
      useImportPolling(importId, { read, onEnded: vi.fn(), onUnauthenticated: vi.fn() }),
    );
    await tick();
    expect(result.current.error).toBe('unavailable');
    await tick(10_000);
    expect(read).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.retry();
    });
    await tick();
    expect(result.current.error).toBeNull();
    expect(result.current.imp?.processedRows).toBe(2);
  });

  it('stops on an import that is not the viewer’s', async () => {
    const read = reads({
      ok: false,
      error: { kind: 'problem', problem: { type: 'not-found', title: 'Not found', status: 404 } },
    });
    const { result } = renderHook(() =>
      useImportPolling(importId, { read, onEnded: vi.fn(), onUnauthenticated: vi.fn() }),
    );
    await tick();
    expect(result.current.error).toBe('not-found');
    await tick(10_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('hands a signed-out session to sign in', async () => {
    const onUnauthenticated = vi.fn();
    const read = reads({ ok: false, error: { kind: 'unauthenticated' } });
    renderHook(() => useImportPolling(importId, { read, onEnded: vi.fn(), onUnauthenticated }));
    await tick();
    expect(onUnauthenticated).toHaveBeenCalled();
  });

  it('does nothing without an import, and stops when unmounted', async () => {
    const read = reads(ok(snapshot({})));
    const idle = renderHook(() =>
      useImportPolling(null, { read, onEnded: vi.fn(), onUnauthenticated: vi.fn() }),
    );
    await tick(5000);
    expect(read).not.toHaveBeenCalled();
    idle.unmount();

    const polling = renderHook(() =>
      useImportPolling(importId, { read, onEnded: vi.fn(), onUnauthenticated: vi.fn() }),
    );
    await tick();
    polling.unmount();
    await tick(10_000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
