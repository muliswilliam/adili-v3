// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DirectoryResult, RosterImport } from '../../server/directory/client';
import type { RosterUploadCheck } from '../../server/roster-imports';
import type { CleanUpload } from './upload';
import { type ColumnCheckDeps, useColumnCheck } from './use-column-check';

const upload = { id: '0199a0b4-0000-7000-8000-000000000001' } as CleanUpload;
const RUNNING = '0199a0b4-0000-7000-8000-0000000000bb';

const check: DirectoryResult<RosterUploadCheck> = {
  ok: true,
  data: {
    preview: {
      uploadId: upload.id,
      fileName: 'psc.csv',
      format: 'csv',
      mapping: { matched: [], ignored: [], missing: [] },
      missingRequired: [],
      estimatedRows: 3,
    },
    roster: null,
  },
};

const inProgress = (importId?: string): DirectoryResult<RosterImport> => ({
  ok: false,
  error: {
    kind: 'problem',
    problem: {
      type: 'import-in-progress',
      title: 'Another import is running',
      status: 409,
      ...(importId ? { importId } : {}),
    },
  },
});

function deps(start: DirectoryResult<RosterImport>): ColumnCheckDeps {
  return {
    check: vi.fn(() => Promise.resolve(check)),
    start: vi.fn(() => Promise.resolve(start)),
    findRunning: vi.fn(() =>
      Promise.resolve<DirectoryResult<RosterImport | null>>({ ok: true, data: null }),
    ),
    onUnauthenticated: vi.fn(),
    onStarted: vi.fn(),
    onViewRunning: vi.fn(),
    onRunningGone: vi.fn(),
    onRunningUnavailable: vi.fn(),
    newIdempotencyKey: () => '0199a0b4-0000-7000-8000-00000000ffff',
  };
}

async function refusedStart(options: ColumnCheckDeps) {
  const hook = renderHook(() => useColumnCheck(upload, options));
  await waitFor(() => {
    expect(hook.result.current.check.phase).toBe('ready');
  });
  await act(() => hook.result.current.start());
  expect(hook.result.current.startFailure).toBe('running');
  return hook;
}

describe('useColumnCheck: View progress', () => {
  it('follows the running import a 409 names, without looking it up', async () => {
    const options = deps(inProgress(RUNNING));
    const { result } = await refusedStart(options);

    await act(() => result.current.viewRunning());

    expect(options.onViewRunning).toHaveBeenCalledWith(RUNNING);
    expect(options.findRunning).not.toHaveBeenCalled();
  });

  it('looks the running import up when the 409 names none', async () => {
    const options = deps(inProgress());
    const { result } = await refusedStart(options);

    await act(() => result.current.viewRunning());

    expect(options.findRunning).toHaveBeenCalled();
    expect(options.onRunningGone).toHaveBeenCalled();
    expect(options.onViewRunning).not.toHaveBeenCalled();
  });
});
