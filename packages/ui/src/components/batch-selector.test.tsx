import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BatchSelector, type BatchSelectorProps } from './batch-selector';

const FILTERS = (
  <label>
    Cycle
    <select defaultValue="2026">
      <option value="2026">Cycle 2026</option>
    </select>
  </label>
);

function renderBatch(props: Partial<BatchSelectorProps> = {}) {
  const handlers = {
    onApprove: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onReset: vi.fn(),
  };
  const view = render(
    <BatchSelector
      filters={FILTERS}
      phase="ready"
      eligible={1240}
      excluded={25}
      {...handlers}
      {...props}
    />,
  );
  return { ...view, handlers };
}

const running = (chunk: number, approved: number): Partial<BatchSelectorProps> => ({
  phase: 'running',
  progress: { chunk, chunks: 13, approved, total: 1240 },
});

describe('BatchSelector', () => {
  it('groups the filters', () => {
    renderBatch();

    const group = screen.getByRole('group', { name: 'Filters' });
    expect(within(group).getByRole('combobox', { name: 'Cycle' })).toBeTruthy();
  });

  it('counts what is ready and approves it on request', () => {
    const { handlers } = renderBatch();

    expect(screen.getByText('1,240 closures ready')).toBeTruthy();
    expect(screen.getByText('25 sampled excluded · 13 chunks of 100')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1,240 closures' }));
    expect(handlers.onApprove).toHaveBeenCalledOnce();
  });

  it('says when nothing is left to approve, with no button', () => {
    renderBatch({ eligible: 0 });

    expect(screen.getByText('Nothing left to approve for these filters')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('locks the filters while approval runs', () => {
    renderBatch(running(3, 300));

    expect(screen.getByRole('combobox', { name: 'Cycle' }).matches(':disabled')).toBe(true);
    expect(screen.getByText('Filters are locked while approval runs.')).toBeTruthy();
  });

  it('shows the chunks approved while it runs', () => {
    renderBatch(running(3, 300));

    expect(screen.getByText('Approving 1,240 closures')).toBeTruthy();
    expect(screen.getByText('3 of 13 chunks approved')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Chunks approved' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('13');
    expect(screen.getByText('300').parentElement?.textContent).toBe('300 approved');
    expect(screen.getByText('940').parentElement?.textContent).toBe('940 to go');
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('counts finished chunks from none at the start of a run', () => {
    renderBatch(running(0, 0));

    expect(screen.getByText('0 of 13 chunks approved')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('names the chunk that failed as the one after the chunks approved', () => {
    const { rerender, handlers } = renderBatch(running(3, 300));
    expect(screen.getByText('3 of 13 chunks approved')).toBeTruthy();

    rerender(
      <BatchSelector
        phase="stopped"
        eligible={1240}
        progress={{ chunk: 3, chunks: 13, approved: 300, total: 1240 }}
        {...handlers}
      />,
    );
    expect(screen.getByText('Approval stopped at chunk 4 of 13')).toBeTruthy();
  });

  it('announces progress only at chunk boundaries', () => {
    const { rerender, handlers } = renderBatch(running(3, 300));
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('Chunk 3 of 13 approved. 300 closures.');

    // A count that moves within a chunk is not read out.
    rerender(
      <BatchSelector
        phase="running"
        eligible={1240}
        progress={{ chunk: 3, chunks: 13, approved: 340, total: 1240 }}
        {...handlers}
      />,
    );
    expect(live.textContent).toBe('Chunk 3 of 13 approved. 300 closures.');

    rerender(
      <BatchSelector
        phase="running"
        eligible={1240}
        progress={{ chunk: 4, chunks: 13, approved: 400, total: 1240 }}
        {...handlers}
      />,
    );
    expect(live.textContent).toBe('Chunk 4 of 13 approved. 400 closures.');

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('reports the batch approved, with its reference range', () => {
    const { handlers } = renderBatch({
      phase: 'done',
      progress: { chunk: 13, chunks: 13, approved: 1240, total: 1240 },
      references: { first: 'CMP-TSC-2026-0000100-1', last: 'CMP-TSC-2026-0001339-K' },
      skipped: 3,
    });

    expect(
      screen.getByText(
        'Approved 1,240 closures (CMP-TSC-2026-0000100-1 to CMP-TSC-2026-0001339-K)',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Approved 1,240 closures.');
    expect(
      screen.getByText(/3 closures of cases you once held are left for another supervisor\./),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve another batch' }));
    expect(handlers.onReset).toHaveBeenCalledOnce();
  });

  it('says where approval stopped and resumes or stops there', () => {
    const { handlers } = renderBatch({
      phase: 'stopped',
      progress: { chunk: 3, chunks: 13, approved: 300, total: 1240 },
      references: { first: 'CMP-TSC-2026-0000100-1', last: 'CMP-TSC-2026-0000399-4' },
      stoppedReason: 'The numbering service did not respond.',
    });

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Approval stopped at chunk 4 of 13')).toBeTruthy();
    expect(alert.textContent).toContain(
      '300 approved (CMP-TSC-2026-0000100-1 to CMP-TSC-2026-0000399-4); 940 unchanged. The numbering service did not respond. Resume skips no numbers.',
    );
    expect(screen.getByRole('progressbar').firstElementChild?.className).toContain(
      'bg-destructive',
    );
    expect(screen.getByRole('combobox', { name: 'Cycle' }).matches(':disabled')).toBe(false);

    fireEvent.click(within(alert).getByRole('button', { name: 'Resume' }));
    expect(handlers.onResume).toHaveBeenCalledOnce();
    fireEvent.click(within(alert).getByRole('button', { name: 'Stop here' }));
    expect(handlers.onStop).toHaveBeenCalledOnce();
  });

  it('says no proposals are made before the clarification window closes', () => {
    renderBatch({ phase: 'pending', eligible: 0, windowClosesAt: '2026-09-30T09:00:00.000Z' });

    expect(screen.getByText('No proposals yet for these filters')).toBeTruthy();
    expect(
      screen.getByText('They appear after the clarification window closes on 30 Sep 2026.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('leaves out the excluded count when there is none to give', () => {
    renderBatch({ excluded: undefined });

    expect(screen.getByText('13 chunks of 100')).toBeTruthy();
  });

  it('does not read the last chunk again when a stopped run resumes', () => {
    const { rerender, handlers } = renderBatch(running(3, 300));
    const live = screen.getByRole('status');
    const at = (phase: BatchSelectorProps['phase'], chunk: number) => (
      <BatchSelector
        phase={phase}
        eligible={1240}
        progress={{ chunk, chunks: 13, approved: chunk * 100, total: 1240 }}
        {...handlers}
      />
    );

    rerender(at('stopped', 3));
    rerender(at('running', 3));
    expect(live.textContent).toBe('Chunk 3 of 13 approved. 300 closures.');

    rerender(at('running', 4));
    expect(live.textContent).toBe('Chunk 4 of 13 approved. 400 closures.');
  });

  it('takes other wording', () => {
    renderBatch({
      messages: {
        ready: (count) => `${count} ziko tayari`,
        approve: (count) => `Idhinisha ${count}`,
      },
    });

    expect(screen.getByText('1,240 ziko tayari')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Idhinisha 1,240' })).toBeTruthy();
  });
});
