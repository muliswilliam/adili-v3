// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BulkApprovalResult, ClosureSummary } from '../../server/closures';
import type { ServiceResult } from '../../server/service-call';
import { BulkClosureView, type BulkClosureViewProps } from './bulk-closure-view';

const invalidate = vi.fn(() => Promise.resolve());

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate }),
}));

const ok = <T,>(data: T) => ({ ok: true as const, data });

const SUMMARY: ClosureSummary = {
  cycleYear: 2026,
  eligibleProposed: 1240,
  sampled: 25,
  approved: 312,
  sampleRate: 0.02,
  windowClosedAt: '2026-08-31T21:00:00.000Z',
  lastSweptAt: '2026-10-01T23:00:00.000Z',
};

const DONE: BulkApprovalResult = {
  approved: 1240,
  skipped: 0,
  firstReference: 'CMP-TSC-2026-0000313-K',
  lastReference: 'CMP-TSC-2026-0001552-P',
  chunks: 13,
};

/** A promise the test settles. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderView(props: Partial<BulkClosureViewProps> = {}) {
  const handlers = {
    onSearchChange: vi.fn(),
    approve: vi.fn<BulkClosureViewProps['approve']>(),
    readSummary: vi.fn<BulkClosureViewProps['readSummary']>(() => Promise.resolve(ok(SUMMARY))),
  };
  render(
    <BulkClosureView
      summary={ok(SUMMARY)}
      search={{ cycle: 2026 }}
      cycles={[2026, 2025, 2024]}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const tile = (label: string) => screen.getByText(label).closest('.rounded-2xl');

/** Confirms the batch in the dialog. */
function approveAll(count = '1,240') {
  fireEvent.click(screen.getByRole('button', { name: `Approve ${count} closures` }));
  const dialog = screen.getByRole('dialog', { name: `Approve ${count} closures?` });
  fireEvent.click(within(dialog).getByRole('button', { name: `Approve ${count} closures` }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  invalidate.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BulkClosureView', () => {
  it('shows the filters, the counts with the sample rate, and the batch ready (S3)', () => {
    renderView();

    expect(screen.getByRole('heading', { level: 1, name: 'Bulk closure' })).toBeTruthy();
    const filters = screen.getByRole('group', { name: 'Filters' });
    expect(within(filters).getByRole('combobox', { name: 'Cycle' }).textContent).toBe('Cycle 2026');
    expect(within(filters).getByRole('combobox', { name: 'Type' }).textContent).toBe('All types');
    const band = within(filters).getByRole('combobox', { name: 'Priority band' });
    expect(band.textContent).toBe('Low only');
    expect(band.matches(':disabled')).toBe(true);
    expect(within(filters).getByRole('combobox', { name: 'Reporting entity' }).textContent).toBe(
      'All reporting entities',
    );

    expect(tile('Eligible proposals')?.textContent).toContain('1,240');
    expect(tile('Sampled for review')?.textContent).toContain('25');
    expect(tile('Sampled for review')?.textContent).toContain('2% sample');
    expect(tile('Already approved')?.textContent).toContain('312');
    expect(screen.getByText('1,240 closures ready')).toBeTruthy();
    expect(screen.getByText('25 sampled excluded · 13 chunks of 100')).toBeTruthy();
  });

  it('puts a type filter in the search', () => {
    const { onSearchChange } = renderView();

    fireEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    fireEvent.click(screen.getByRole('option', { name: 'Biennial' }));
    expect(onSearchChange).toHaveBeenCalledWith({ cycle: 2026, type: 'biennial' });
  });

  it('says what approving does before it starts (S4)', () => {
    const { approve } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Approve 1,240 closures' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve 1,240 closures?' });
    expect(dialog.textContent).toContain(
      'Each closure receives a CMP number in your name. Sampled cases are excluded and appear in the review queue.',
    );
    expect(dialog.textContent).toContain('Cycle 2026 · All types · Low priority');
    expect(dialog.textContent).toContain('1,240 CMP numbers are allocated in order');
    expect(dialog.textContent).toContain('Each declarant is notified');
    expect(dialog.textContent).toContain('Decision letters are prepared on demand');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(approve).not.toHaveBeenCalled();
  });

  it('shows the chunks landing while it runs, then the CMP range (S4)', async () => {
    const run = deferred<ServiceResult<BulkApprovalResult>>();
    const { approve, readSummary } = renderView();
    approve.mockReturnValue(run.promise);
    readSummary.mockResolvedValue(
      ok({ ...SUMMARY, eligibleProposed: 940, approved: SUMMARY.approved + 300 }),
    );

    approveAll();
    expect(approve).toHaveBeenCalledOnce();
    expect(screen.getByText('Approving 1,240 closures')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Type' }).matches(':disabled')).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('3 of 13 chunks approved')).toBeTruthy();
    expect(screen.getAllByRole('status').map((each) => each.textContent)).toContain(
      'Chunk 3 of 13 approved. 300 closures.',
    );
    expect(tile('Eligible proposals')?.textContent).toContain('940');

    await act(async () => {
      run.resolve(ok(DONE));
      await run.promise;
    });
    expect(
      screen.getByText(
        'Approved 1,240 closures (CMP-TSC-2026-0000313-K to CMP-TSC-2026-0001552-P)',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve another batch' }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('says how many were left for another supervisor', async () => {
    const { approve } = renderView();
    approve.mockResolvedValue(ok({ ...DONE, approved: 1237, skipped: 3 }));

    approveAll();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(
      screen.getByText(/3 closures of cases you once held are left for another supervisor/),
    ).toBeTruthy();
  });

  it('stops with what stayed approved, and resumes under the same key', async () => {
    const { approve, readSummary } = renderView();
    approve.mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } });
    readSummary.mockResolvedValue(
      ok({ ...SUMMARY, eligibleProposed: 940, approved: SUMMARY.approved + 300 }),
    );

    approveAll();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Approval stopped at chunk 4 of 13')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('300 approved; 940 unchanged.');
    expect(screen.getByRole('alert').textContent).toContain('The review service did not respond.');

    approve.mockResolvedValueOnce(ok(DONE));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(approve).toHaveBeenCalledTimes(2);
    const [first, second] = approve.mock.calls;
    expect(second?.[0]).toBe(first?.[0]);
    expect(
      screen.getByText(
        'Approved 1,240 closures (CMP-TSC-2026-0000313-K to CMP-TSC-2026-0001552-P)',
      ),
    ).toBeTruthy();
  });

  it('starts a new key for the next batch', async () => {
    const { approve } = renderView();
    approve.mockResolvedValue(ok(DONE));

    approveAll();
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Approve another batch' }));
    approveAll();
    await act(() => vi.advanceTimersByTimeAsync(0));
    const [first, second] = approve.mock.calls;
    expect(second?.[0]).not.toBe(first?.[0]);
  });

  it('stops here, reading the counts again', async () => {
    const { approve } = renderView();
    approve.mockResolvedValue({ ok: false, error: { kind: 'unavailable', detail: null } });

    approveAll();
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Stop here' }));
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByText('1,240 closures ready')).toBeTruthy();
  });

  it('has no proposals before the sweep: when the clarification window closes', () => {
    renderView({
      summary: ok({
        ...SUMMARY,
        eligibleProposed: 0,
        sampled: 0,
        approved: 0,
        windowClosedAt: '2026-12-30T21:00:00.000Z',
        lastSweptAt: null,
      }),
    });

    expect(screen.getByText('No proposals yet for these filters')).toBeTruthy();
    expect(
      screen.getByText(
        'Bulk proposals appear after the clarification window closes on 31 Dec 2026.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Eligible proposals')).toBeNull();
  });

  it('has nothing left to approve once every proposal is approved', () => {
    renderView({ summary: ok({ ...SUMMARY, eligibleProposed: 0, approved: 980 }) });

    expect(screen.getByText('Nothing left to approve for these filters')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
  });

  it('tells a reviewer bulk closure is for supervisors (403)', () => {
    renderView({
      summary: {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
        },
      },
    });

    expect(screen.getByText('Only a supervisor can approve bulk closures.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filters' })).toBeNull();
  });

  it('offers a retry when the counts could not be loaded', () => {
    renderView({ summary: { ok: false, error: { kind: 'unavailable', detail: null } } });

    expect(screen.getByText('We could not load the bulk closures')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps its shape while the counts load', () => {
    renderView({ summary: null });

    expect(screen.getByRole('group', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
  });
});
