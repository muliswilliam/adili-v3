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

  it('shows a late request awaiting representations as late, with the window under it', async () => {
    const data = await page();
    const awaiting = data.items.find((item) => item.status === 'awaiting-representations');
    if (!awaiting?.windowEndsAt) throw new Error('no window');
    renderList({ ok: true, data: { items: [{ ...awaiting, late: true }], nextCursor: null } });
    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    const chip = row?.querySelector('time');
    expect(chip?.dataset.state).toBe('late');
    expect(chip?.textContent).toMatch(/late/i);
    expect(row?.textContent).toContain('Closes');
  });

  it('keeps the name the request sought under the identified officer when it differs', async () => {
    const data = await page();
    const resolved = data.items.find((item) => item.resolvedName);
    if (!resolved?.resolvedName) throw new Error('none resolved');
    renderList({
      ok: true,
      data: {
        items: [
          { ...resolved, officerSought: 'G. Atieno' },
          { ...resolved, id: crypto.randomUUID(), officerSought: resolved.resolvedName },
        ],
        nextCursor: null,
      },
    });
    const [, differs, same] = within(screen.getByRole('table')).getAllByRole('row');
    expect(differs?.textContent).toContain('Sought as G. Atieno');
    expect(same?.textContent).not.toContain('Sought as');
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

  it('S11: lists law enforcement requests with the agency and their 14-day deadline', async () => {
    const result = await loadQueue(mockAccessClient([ACCESS_OFFICER]), 'psc', { kind: 'lea' });
    if (!result.ok) throw new Error('not ok');
    renderList(result, { kind: 'lea' });
    const table = screen.getByRole('table', { name: 'Access requests, earliest deadline first' });
    expect(within(table).getByRole('columnheader', { name: 'Agency' })).toBeTruthy();
    const rows = within(table).getAllByRole('row').slice(1);
    const breach = rows[0];
    if (!breach) throw new Error('no rows');
    expect(breach.textContent).toMatch(/^LEA-PSC-2026-/);
    expect(breach.textContent).toContain('Law enforcement ·');
    expect(breach.textContent).toContain('Office of the Director of Public Prosecutions');
    expect(breach.textContent).toContain('Received');
    expect(breach.querySelector('time')?.dataset.state).toBe('late');
    // No window for representations on this tab.
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(within(chips).queryByRole('button', { name: 'Awaiting representations' })).toBeNull();
  });
});
