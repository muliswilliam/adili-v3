// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  DirectoryResult,
  RosterImportRow,
  RosterImportRowPage,
} from '../../server/directory/client';
import { RejectedRows, type RejectedRowsProps } from './rejected-rows';
import { useRejectedRows } from './use-rejected-rows';

const IMPORT_ID = '0199a0b4-0000-7000-8000-0000000000aa';

const row = (rowNumber: number, overrides: Partial<RosterImportRow> = {}): RosterImportRow => ({
  rowNumber,
  status: 'rejected',
  raw: { personnelFileNumber: `PSC/2020/${String(rowNumber).padStart(4, '0')}` },
  errors: [{ field: 'fullName', code: 'required', message: 'Full name is required.' }],
  outcome: null,
  recordId: null,
  ...overrides,
});

const page = (
  from: number,
  count: number,
  nextCursor: string | null,
): DirectoryResult<RosterImportRowPage> => ({
  ok: true,
  data: { items: Array.from({ length: count }, (_, index) => row(from + index)), nextCursor },
});

describe('useRejectedRows', () => {
  it('reads the first page, then pages forward and back by cursor', async () => {
    const read = vi.fn((cursor: string | undefined) =>
      Promise.resolve(cursor === 'c2' ? page(52, 3, null) : page(2, 50, 'c2')),
    );
    const { result } = renderHook(() =>
      useRejectedRows(IMPORT_ID, { read, onUnauthenticated: vi.fn() }),
    );
    expect(result.current.view.phase).toBe('loading');
    await waitFor(() => {
      expect(result.current.view.phase).toBe('ready');
    });
    expect(read).toHaveBeenLastCalledWith(undefined);
    const first = result.current.view;
    if (first.phase !== 'ready') throw new Error('expected rows');
    expect(first.paging).toEqual({ range: { from: 1, to: 50 }, hasPrevious: false, hasNext: true });

    act(() => {
      result.current.next();
    });
    await waitFor(() => {
      const view = result.current.view;
      expect(view.phase === 'ready' && view.paging.range).toEqual({ from: 51, to: 53 });
    });
    expect(read).toHaveBeenLastCalledWith('c2');
    const second = result.current.view;
    expect(second.phase === 'ready' && second.paging.hasNext).toBe(false);
    expect(second.phase === 'ready' && second.paging.hasPrevious).toBe(true);

    act(() => {
      result.current.previous();
    });
    await waitFor(() => {
      const view = result.current.view;
      expect(view.phase === 'ready' && view.paging.range).toEqual({ from: 1, to: 50 });
    });
  });

  it("uses the loader's first page without reading it again", () => {
    const read = vi.fn(() => Promise.resolve(page(2, 1, null)));
    const { result } = renderHook(() =>
      useRejectedRows(
        IMPORT_ID,
        { read, onUnauthenticated: vi.fn() },
        { initial: page(2, 1, null) },
      ),
    );
    expect(result.current.view.phase).toBe('ready');
    expect(read).not.toHaveBeenCalled();
  });

  it('starts another import at its first page', async () => {
    const OTHER = '0199a0b4-0000-7000-8000-0000000000bb';
    const read = vi.fn((cursor: string | undefined) =>
      Promise.resolve(cursor === 'c2' ? page(52, 3, null) : page(2, 50, 'c2')),
    );
    const deps = { read, onUnauthenticated: vi.fn() };
    const { result, rerender } = renderHook(({ id }) => useRejectedRows(id, deps), {
      initialProps: { id: IMPORT_ID },
    });
    await waitFor(() => {
      expect(result.current.view.phase).toBe('ready');
    });
    act(() => {
      result.current.next();
    });
    await waitFor(() => {
      expect(read).toHaveBeenLastCalledWith('c2');
    });

    rerender({ id: OTHER });

    await waitFor(() => {
      const view = result.current.view;
      expect(view.phase === 'ready' && view.paging).toEqual({
        range: { from: 1, to: 50 },
        hasPrevious: false,
        hasNext: true,
      });
    });
    expect(read).toHaveBeenLastCalledWith(undefined);
  });

  it('pages through the location a pager keeps, starting where it is', async () => {
    const read = vi.fn(() => Promise.resolve(page(52, 3, 'c3')));
    const go = vi.fn();
    const pager = {
      location: { search: { cursor: 'c2' }, state: { trail: [], offset: null } },
      go,
    };
    const { result } = renderHook(() =>
      useRejectedRows(IMPORT_ID, { read, onUnauthenticated: vi.fn() }, { pager }),
    );
    await waitFor(() => {
      expect(result.current.view.phase).toBe('ready');
    });
    expect(read).toHaveBeenLastCalledWith('c2');

    act(() => {
      result.current.next();
    });

    expect(go).toHaveBeenCalledWith({
      search: { cursor: 'c3' },
      state: { trail: [{ cursor: 'c2', offset: null }], offset: null },
    });
  });

  it('reads nothing without an import', () => {
    const read = vi.fn(() => Promise.resolve(page(2, 1, null)));
    renderHook(() => useRejectedRows(null, { read, onUnauthenticated: vi.fn() }));
    expect(read).not.toHaveBeenCalled();
  });

  it('says why the rows could not be read, and retries', async () => {
    const read = vi
      .fn<(cursor: string | undefined) => Promise<DirectoryResult<RosterImportRowPage>>>()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'import-rows-purged', title: 'Gone', status: 410 },
        },
      })
      .mockResolvedValueOnce(page(2, 1, null));
    const { result } = renderHook(() =>
      useRejectedRows(IMPORT_ID, { read, onUnauthenticated: vi.fn() }),
    );
    await waitFor(() => {
      expect(result.current.view).toEqual({ phase: 'failed', failure: 'purged' });
    });
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.view.phase).toBe('ready');
    });
  });

  it('sends the user to sign in when the session has ended', async () => {
    const onUnauthenticated = vi.fn();
    const read = vi.fn(() =>
      Promise.resolve<DirectoryResult<RosterImportRowPage>>({
        ok: false,
        error: { kind: 'unauthenticated' },
      }),
    );
    renderHook(() => useRejectedRows(IMPORT_ID, { read, onUnauthenticated }));
    await waitFor(() => {
      expect(onUnauthenticated).toHaveBeenCalled();
    });
  });
});

describe('RejectedRows', () => {
  const props = (overrides: Partial<RejectedRowsProps> = {}): RejectedRowsProps => ({
    imp: {
      channel: 'file',
      counts: {
        accepted: 10,
        created: 5,
        updated: 2,
        unchanged: 0,
        rejected: 3,
        flaggedAbsent: 0,
        exitsRecorded: 0,
      },
    },
    view: { phase: 'loading' },
    downloading: false,
    onDownload: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  });

  const ready = (items: RosterImportRow[], hasNext = false) =>
    ({
      phase: 'ready',
      page: { items, nextCursor: hasNext ? 'next' : null },
      paging: { range: { from: 1, to: items.length }, hasPrevious: false, hasNext },
    }) as const;

  it('lists each row with its fields and reasons, and downloads the CSV', () => {
    const onDownload = vi.fn();
    render(
      <RejectedRows
        {...props({
          onDownload,
          view: ready([
            row(3038, {
              errors: [
                { field: 'email', code: 'format', message: 'Email address is not valid.' },
                { field: 'phone', code: 'format', message: 'Phone number is not valid.' },
              ],
            }),
            row(14, { raw: {} }),
          ]),
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Rejected rows 3' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Rejected rows' });
    const first = within(table).getByRole('rowheader', { name: '3,038' }).closest('tr');
    if (!first) throw new Error('expected a row');
    expect(within(first).getByText('PSC/2020/3038')).toBeTruthy();
    expect(within(first).getByText('email')).toBeTruthy();
    expect(within(first).getByText('phone')).toBeTruthy();
    expect(within(first).getByText('Phone number is not valid.')).toBeTruthy();
    const second = within(table).getByRole('rowheader', { name: '14' }).closest('tr');
    expect(second && within(second).getByText('None')).toBeTruthy();
    // One page: no pager.
    expect(screen.queryByRole('navigation')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Download rejected rows (CSV)' }));
    expect(onDownload).toHaveBeenCalled();
  });

  it('pages when there is more than one page, from the top of the list', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onNext = vi.fn();
    render(<RejectedRows {...props({ onNext, view: ready([row(2)], true) })} />);
    const pager = screen.getByRole('navigation', { name: 'Rejected rows pages' });
    expect(pager.textContent).toContain('Showing 1-1 rows');
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }));
    expect(onNext).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('shows a busy download', () => {
    render(<RejectedRows {...props({ downloading: true, view: ready([row(2)]) })} />);
    const button = screen.getByRole('button', { name: 'Downloading…' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('says purged rows are kept 30 days, without a download', () => {
    render(<RejectedRows {...props({ view: { phase: 'failed', failure: 'purged' } })} />);
    expect(screen.getByText('Row details are kept for 30 days after an import ends.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('tells EACC the details are for the Commission', () => {
    render(<RejectedRows {...props({ view: { phase: 'failed', failure: 'commission-only' } })} />);
    expect(screen.getByText('Rejected row details are only shown to the Commission.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('offers a retry when the rows could not be loaded', () => {
    const onRetry = vi.fn();
    render(<RejectedRows {...props({ onRetry, view: { phase: 'failed', failure: 'failed' } })} />);
    expect(screen.getByText('The rejected rows could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('asks HR system imports to fix rows at the source', () => {
    render(
      <RejectedRows
        {...props({ imp: { ...props().imp, channel: 'api' }, view: ready([row(2)]) })}
      />,
    );
    expect(screen.getByText('Fix them in your HR system and send again.')).toBeTruthy();
  });
});
