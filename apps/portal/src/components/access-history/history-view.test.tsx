// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { HistoryFilter } from '../../access/history';
import type { AccessHistoryEntry, DeclarantNotice } from '../../server/access/types';
import { getMyCertifiedCopyDownload } from '../../server/certified-copies';
import { downloadFrom } from '../download';
import { HistoryView } from './history-view';
import { NOW, seededHistory } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/certified-copies', () => ({
  getMyCertifiedCopy: vi.fn(),
  getMyCertifiedCopyDownload: vi.fn(),
  requestMyCertifiedCopy: vi.fn(),
}));
vi.mock('../download', () => ({ downloadFrom: vi.fn() }));

/** Clicks, and lets the server functions it calls settle. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

let entries: AccessHistoryEntry[] = [];
let notices: DeclarantNotice[] = [];

beforeAll(async () => {
  ({ entries, notices } = await seededHistory());
});

function renderView(
  props: Partial<{
    entries: AccessHistoryEntry[];
    notices: DeclarantNotice[];
    filter: HistoryFilter;
    page: number;
  }> = {},
) {
  const onFilter = vi.fn();
  const onPage = vi.fn();
  render(
    <ToastProvider>
      <TooltipProvider>
        <HistoryView
          entries={props.entries ?? entries}
          notices={props.notices ?? notices}
          now={NOW}
          filter={props.filter ?? 'all'}
          page={props.page ?? 1}
          onFilter={onFilter}
          onPage={onPage}
        />
      </TooltipProvider>
    </ToastProvider>,
  );
  return { onFilter, onPage };
}

describe('Who accessed my declaration', () => {
  it('lists the newest entries by month, ten to a page, in the declarant’s words', () => {
    renderView();
    const list = screen.getByRole('group', { name: 'Who accessed my declaration' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toContain('Wanjiru Kamau asked to see your declaration');
    expect(within(list).getByRole('heading', { level: 2, name: 'September 2026' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Pages of entries' })).toBeDefined();
  });

  it('calls out a request waiting for the declarant, with Respond', () => {
    renderView();
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Wanjiru Kamau asked to see your declaration. Respond by');
    expect(within(note).getByRole('link', { name: 'Respond' }).getAttribute('href')).toBe(
      '/access/notices/b7e10000-0000-4000-8000-000000000001',
    );
  });

  it('filters by what the entries are about, with counts', async () => {
    const { onFilter } = renderView({ filter: 'lea' });
    const lea = screen.getByRole('button', { name: 'Law enforcement 8 entries' });
    expect(lea.getAttribute('aria-pressed')).toBe('true');
    const rows = within(
      screen.getByRole('group', { name: 'Who accessed my declaration' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(8);
    await click(screen.getByRole('button', { name: 'Certified copies 2 entries' }));
    expect(onFilter).toHaveBeenCalledWith('copy');
  });

  it('opens a request in a drawer with its details and timeline', async () => {
    renderView({ page: 2 });
    await click(
      screen.getByRole('button', { name: /Teachers Service Commission partially granted access/ }),
    );
    const drawer = screen.getByRole('dialog', { name: 'Access request' });
    expect(drawer.textContent).toContain('Joseph Maina Kariuki');
    expect(drawer.textContent).toContain('Suspected conflict of interest in a supplies contract');
    expect(drawer.textContent).toContain('You objected');
    expect(drawer.textContent).toContain('Partially granted');
    expect(drawer.textContent).toContain('2026 · You only · Income, assets');
    expect(drawer.textContent).toContain('(d) the reason for the access');
    const timeline = within(drawer).getByRole('list', { name: 'Timeline' });
    expect(within(timeline).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
    expect(within(drawer).getByRole('link', { name: 'Open access request' })).toBeDefined();
  });

  it('without the notice, still says why and for what, from the register', async () => {
    renderView({ page: 2, notices: [] });
    await click(
      screen.getByRole('button', { name: /Teachers Service Commission partially granted access/ }),
    );
    const drawer = screen.getByRole('dialog', { name: 'Access request' });
    expect(drawer.textContent).toContain('Joseph Maina Kariuki');
    expect(drawer.textContent).toContain('Suspected conflict of interest in a supplies contract');
    expect(drawer.textContent).toMatch(/Scope asked.*2025, 2026/);
    expect(drawer.textContent).toContain('Scope granted2026 · You only · Income, assets');
  });

  it('opens a law-enforcement grant without naming any officer', async () => {
    renderView({ filter: 'lea' });
    await click(screen.getByRole('button', { name: /Asset Recovery Agency was granted access/ }));
    const drawer = screen.getByRole('dialog', { name: 'Law-enforcement request' });
    expect(drawer.textContent).toContain('ARA/INV/2026/014');
    expect(drawer.textContent).toContain('Granted');
    expect(
      within(drawer).getByRole('link', { name: 'Open law-enforcement request' }),
    ).toBeDefined();
    expect(within(drawer).queryByRole('link', { name: 'Open access request' })).toBeNull();
  });

  it('shows a law-enforcement grant by agency, case, outcome, dates and the scope granted only', async () => {
    renderView({ filter: 'lea' });
    await click(
      screen.getByRole('button', {
        name: /Directorate of Criminal Investigations was partially granted access/,
      }),
    );
    const drawer = screen.getByRole('dialog', { name: 'Law-enforcement request' });
    const facts = Object.fromEntries(
      within(drawer)
        .getAllByRole('term')
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(facts).toEqual({
      Agency: 'Directorate of Criminal Investigations',
      'Case reference': 'DCI/ECU/2026/0331',
      Outcome: 'Partially granted',
      'Granted on': '15 May 2026',
      'Notified on': '15 May 2026',
      'Scope granted (what was disclosed)': '2025 · You only · Assets',
    });
    for (const hidden of [/scope asked/i, /purpose/i, /reasons/i, /grounds/i]) {
      expect(within(drawer).queryByText(hidden)).toBeNull();
    }
  });

  it('opens a certified copy and downloads it', async () => {
    vi.mocked(getMyCertifiedCopyDownload).mockResolvedValue({
      status: 'ok',
      downloadUrl: '/copy.pdf',
    });
    renderView({ filter: 'copy' });
    await click(
      screen.getByRole('button', { name: /Mary Kennedy obtained a certified copy for you/ }),
    );
    const drawer = screen.getByRole('dialog', { name: 'Certified copy' });
    expect(drawer.textContent).toContain('Mary Kennedy, your representative');
    expect(drawer.textContent).toContain('Restricted');
    await click(within(drawer).getByRole('button', { name: 'Download' }));
    expect(downloadFrom).toHaveBeenCalledWith('/copy.pdf');
  });

  it('says so when no one has accessed the declaration', () => {
    renderView({ entries: [], notices: [] });
    expect(screen.getByText('No one has accessed your declaration')).toBeDefined();
    expect(
      screen.getByText('Requests, decisions, downloads and certified copies will show here.'),
    ).toBeDefined();
  });

  it('offers Show all when a filter matches nothing', async () => {
    const { onFilter } = renderView({
      entries: entries.filter((each) => each.subjectKind !== 'lea-request'),
      filter: 'lea',
    });
    expect(screen.getByText('Nothing here')).toBeDefined();
    await click(screen.getByRole('button', { name: 'Show all' }));
    expect(onFilter).toHaveBeenCalledWith('all');
  });
});
