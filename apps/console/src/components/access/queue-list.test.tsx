// @vitest-environment jsdom
import { ACCESS_OFFICER } from '@adili/roles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadQueue } from '../../server/access-requests.server';
import type { QueuePage } from '../../server/access/types';
import { mockAccessClient, resetAccessMock } from '../../server/access/mock.server';
import { QueueList } from './queue-list';

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));

async function page(): Promise<QueuePage> {
  const result = await loadQueue(mockAccessClient([ACCESS_OFFICER]), 'psc', {});
  if (!result.ok) throw new Error('not ok');
  return result.data;
}

function renderList(
  result: Parameters<typeof QueueList>[0]['result'],
  search: Parameters<typeof QueueList>[0]['search'] = {},
) {
  const onSearchChange = vi.fn();
  render(
    <QueueList
      result={result}
      search={search}
      onSearchChange={onSearchChange}
      requestLink={(item) => <a href={`/access/requests/${item.id}`}>{item.reference}</a>}
    />,
  );
  return onSearchChange;
}

beforeEach(() => {
  resetAccessMock();
});

describe('QueueList (spec 10 FE-5)', () => {
  it('lists each request with who asked, the officer, its status and the deadline that runs', async () => {
    renderList({ ok: true, data: await page() });
    const table = screen.getByRole('table', { name: 'Access requests, earliest deadline first' });
    const rows = within(table).getAllByRole('row').slice(1);
    const late = rows[0];
    if (!late) throw new Error('no rows');
    expect(within(late).getByRole('link').textContent).toBe('ARQ-PSC-2026-0000060-1');
    expect(late.textContent).toContain('Lilian Wairimu Njoroge');
    expect(late.textContent).toContain('File 20102284');
    expect(late.textContent).toContain('Under decision');
    // The late badge: the decision deadline, red, days late.
    const chip = late.querySelector('time');
    expect(chip?.dataset.state).toBe('late');
    expect(chip?.textContent).toMatch(/\d+ days late/);
    const window = rows.find((row) => row.textContent.includes('Awaiting representations'));
    expect(window?.textContent).toContain('Closes');
    const unresolved = rows.find((row) => row.textContent.includes('Mrs Kamau'));
    expect(unresolved?.textContent).toContain('Not identified yet');
    const decided = rows.find((row) => row.textContent.includes('Granted'));
    expect(decided?.textContent).toMatch(/Decided \d+ \w{3}/);
  });

  it('filters one way at a time, keeping the search', () => {
    const onSearchChange = renderList(
      { ok: true, data: { items: [], nextCursor: null } },
      { search: 'Kamau' },
    );
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(within(chips).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(chips).getByRole('button', { name: 'Late' }));
    expect(onSearchChange).toHaveBeenCalledWith({ filter: 'late', search: 'Kamau' });
  });

  it('tells no matches, with a way back, from an empty queue', () => {
    const empty = { ok: true as const, data: { items: [], nextCursor: null } };
    const onSearchChange = renderList(empty, { filter: 'late' });
    expect(screen.getByText('No matches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('shows the empty queue, the loading rows and a load error', () => {
    const { unmount } = render(
      <QueueList
        result={{ ok: true, data: { items: [], nextCursor: null } }}
        search={{}}
        onSearchChange={vi.fn()}
        requestLink={() => null}
      />,
    );
    expect(screen.getByText('No requests yet')).toBeTruthy();
    unmount();
    renderList(null);
    expect(
      screen.getByRole('table', { name: 'Loading access requests' }).getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('says when the queue could not load', () => {
    renderList({ ok: false, error: { kind: 'unavailable', detail: null } });
    expect(screen.getByText('We could not load the queue')).toBeTruthy();
  });
});
