// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCaseComparison } from '../../../server/review-case';
import type { VersionComparison } from '../../../server/review/types';
import { useCaseComparison } from './use-case-comparison';

vi.mock('../../../server/review-case', () => ({ getCaseComparison: vi.fn() }));

const CASE = 'ca5e0000-0000-4000-8000-000000000001';

const comparison = (previousVersion: number, currentVersion: number): VersionComparison => ({
  previousVersion,
  currentVersion,
  statements: [],
});

/** A comparison read that answers when the test says so. */
function deferred() {
  let answer: (value: Awaited<ReturnType<typeof getCaseComparison>>) => void = () => undefined;
  const promise = new Promise<Awaited<ReturnType<typeof getCaseComparison>>>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}

beforeEach(() => {
  vi.mocked(getCaseComparison).mockReset();
});

describe('useCaseComparison', () => {
  it('keeps the newer version’s comparison when the older read answers last', async () => {
    const older = deferred();
    const newer = deferred();
    vi.mocked(getCaseComparison)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result, rerender } = renderHook(({ version }) => useCaseComparison(CASE, version), {
      initialProps: { version: 2 },
    });
    act(() => {
      result.current.setOn(true);
    });
    // A new version is processed while the first read is out.
    rerender({ version: 3 });
    await act(async () => {
      newer.answer({ ok: true, data: comparison(2, 3) });
      await newer.promise;
    });
    await act(async () => {
      older.answer({ ok: false, error: { kind: 'unavailable', detail: null } });
      await older.promise;
    });
    expect(result.current.state).toMatchObject({ status: 'ready', view: { currentVersion: 3 } });
    // The stale failure did not mark the newer read as owed again.
    act(() => {
      result.current.setOn(false);
    });
    act(() => {
      result.current.setOn(true);
    });
    expect(getCaseComparison).toHaveBeenCalledTimes(2);
  });
});
