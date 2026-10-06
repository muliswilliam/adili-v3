// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { NationalReportLoad, NationalReportResult } from '../../server/national-report.server';
import type { NationalAggregates, NationalReport } from '../../server/reporting/types';
import { useEarlierAggregates } from './use-earlier-aggregates';

/** FY 2025/2026's report, as much of it as the hook reads: paragraphs citing `keys`. */
const citing = (...keys: string[]) =>
  ({
    narrativeParagraphs: [
      {
        id: crypto.randomUUID(),
        section: 'overview',
        position: 0,
        text: 'Filing rose on the year before.',
        aiDraft: true,
        aggregateRefs: keys,
        candidateIds: [],
      },
    ],
  }) as unknown as NationalReport;

/** A year's report, as much of it as the hook reads: its aggregates. */
const reportOf = (fy: number): NationalReportResult<NationalReport> => ({
  ok: true,
  data: { aggregates: { fy } as NationalAggregates } as NationalReport,
});

const problem = (status: number): NationalReportResult<NationalReport> => ({
  ok: false,
  error: { kind: 'problem', problem: { type: 'about:blank', title: 'Problem', status } },
});

const UNAVAILABLE: NationalReportResult<NationalReport> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

const SIGNED_OUT: NationalReportResult<NationalReport> = {
  ok: false,
  error: { kind: 'unauthenticated' },
};

function renderEarlier(report: NationalReport, loadReport: NationalReportLoad) {
  const onUnauthenticated = vi.fn();
  const hook = renderHook(
    ({ shown }: { shown: NationalReport }) =>
      useEarlierAggregates({ fy: 2025, report: shown, loadReport, onUnauthenticated }),
    { initialProps: { shown: report } },
  );
  return { ...hook, onUnauthenticated };
}

const settled = () => act(() => Promise.resolve());
const focus = () => {
  act(() => {
    window.dispatchEvent(new FocusEvent('focus'));
  });
};
const years = (aggregates: NationalAggregates[]) => aggregates.map(({ fy }) => fy);

describe("earlier years' aggregates", () => {
  it('reads each earlier year a paragraph cites, latest first', async () => {
    const loadReport = vi.fn<NationalReportLoad>((fy) => Promise.resolve(reportOf(fy)));
    const { result } = renderEarlier(
      citing('fy2024.national.filed', 'fy2025.national.filingRate', 'national.filed'),
      loadReport,
    );

    await waitFor(() => {
      expect(years(result.current)).toEqual([2024, 2023]);
    });
    expect(loadReport.mock.calls.map(([fy]) => fy).sort()).toEqual([2023, 2024]);
  });

  it.each([
    ['could not be reached', UNAVAILABLE],
    ['was busy (429)', problem(429)],
  ])('reads a year whose service %s again when the window regains focus', async (_, failure) => {
    const loadReport = vi.fn<NationalReportLoad>();
    loadReport.mockResolvedValueOnce(failure);
    loadReport.mockResolvedValue(reportOf(2024));
    const { result } = renderEarlier(citing('fy2025.national.filingRate'), loadReport);
    await waitFor(() => {
      expect(loadReport).toHaveBeenCalledTimes(1);
    });
    await settled();
    expect(result.current).toEqual([]);
    expect(loadReport).toHaveBeenCalledTimes(1);

    focus();

    await waitFor(() => {
      expect(years(result.current)).toEqual([2024]);
    });
    expect(loadReport).toHaveBeenCalledTimes(2);
    // Nothing left to read: focus asks for nothing more.
    focus();
    await settled();
    expect(loadReport).toHaveBeenCalledTimes(2);
  });

  it.each([404, 403])('does not ask again for a year the service answered %i', async (status) => {
    const loadReport = vi.fn<NationalReportLoad>().mockResolvedValue(problem(status));
    const { result, rerender } = renderEarlier(citing('fy2025.national.filingRate'), loadReport);
    await waitFor(() => {
      expect(loadReport).toHaveBeenCalledTimes(1);
    });
    await settled();

    focus();
    rerender({ shown: citing('fy2025.national.filingRate') });
    await settled();
    expect(loadReport).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);
  });

  it('sends a viewer whose session ended to sign in once, and asks for nothing after', async () => {
    const loadReport = vi.fn<NationalReportLoad>().mockResolvedValue(SIGNED_OUT);
    const { rerender, onUnauthenticated } = renderEarlier(
      citing('fy2025.national.filingRate', 'fy2024.national.filingRate'),
      loadReport,
    );
    await waitFor(() => {
      expect(onUnauthenticated).toHaveBeenCalled();
    });
    await settled();
    expect(loadReport).toHaveBeenCalledTimes(2);

    focus();
    rerender({ shown: citing('fy2025.national.filingRate', 'fy2023.national.filed') });
    await settled();
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(loadReport).toHaveBeenCalledTimes(2);
  });

  it('reads a year once and still sends to sign in under StrictMode', async () => {
    const onUnauthenticated = vi.fn();
    const loadReport = vi.fn<NationalReportLoad>().mockResolvedValue(SIGNED_OUT);
    const report = citing('fy2025.national.filingRate');
    renderHook(() => useEarlierAggregates({ fy: 2025, report, loadReport, onUnauthenticated }), {
      wrapper: StrictMode,
    });

    await waitFor(() => {
      expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    });
    expect(loadReport).toHaveBeenCalledTimes(1);
  });
});
