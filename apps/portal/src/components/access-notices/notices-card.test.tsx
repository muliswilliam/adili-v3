// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { NoticesLoad } from '../../server/access-notices';
import { AccessNoticesSection } from './notices-card';
import { NoticesList } from './notices-list';
import { IDS, NOW, seededNotices } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);

async function renderSection(load: NoticesLoad, placement: 'first' | 'last') {
  await act(async () => {
    render(<AccessNoticesSection notices={Promise.resolve(load)} placement={placement} />);
    await Promise.resolve();
  });
}

describe('the Access requests card on Home', () => {
  it('goes on top while a request waits for a response, with the two that matter most', async () => {
    const notices = await seededNotices();
    await renderSection({ status: 'ok', notices, now: NOW }, 'first');
    const card = screen.getByRole('region', { name: 'Access requests' });
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Someone has requested access to your declaration');
    expect(rows[0]?.textContent).toContain('Wanjiru Kamau');
    expect(rows[0]?.textContent).toContain('2026 · You and spouse · Income, assets, liabilities');
    expect(rows[0]?.textContent).toContain('Respond by 7 Oct 2026 · 5 days left');
    expect(
      within(card)
        .getByRole('link', { name: /View all/ })
        .getAttribute('href'),
    ).toBe('/access/notices');
  });

  it('shows once only: on top while waiting, else under the obligations', async () => {
    const notices = await seededNotices();
    await renderSection({ status: 'ok', notices, now: NOW }, 'last');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('goes under the obligations when nothing waits, and not on top', async () => {
    const decided = (await seededNotices()).filter(
      (notice) => notice.kind === 'lea' || !notice.canRespond,
    );
    await renderSection({ status: 'ok', notices: decided, now: NOW }, 'first');
    expect(screen.queryByRole('region')).toBeNull();
    await renderSection({ status: 'ok', notices: decided, now: NOW }, 'last');
    const rows = within(screen.getByRole('region')).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Access request from Grace Njeri Mwangi');
    expect(rows[0]?.textContent).toContain('Under decision');
  });

  it('is not shown without requests, and says so when they could not load', async () => {
    await renderSection({ status: 'ok', notices: [], now: NOW }, 'last');
    expect(screen.queryByRole('region')).toBeNull();
    await renderSection({ status: 'unavailable', now: NOW }, 'first');
    expect(screen.queryByRole('region')).toBeNull();
    await renderSection({ status: 'unavailable', now: NOW }, 'last');
    expect(screen.getByRole('region').textContent).toContain(
      'We could not load your access requests',
    );
  });
});

describe('Access requests', () => {
  it('puts open windows under Open and the rest under Earlier, each a link to its page', async () => {
    const notices = await seededNotices();
    render(<NoticesList notices={notices} page={1} now={NOW} onPage={vi.fn()} />);
    const open = screen.getByRole('list', { name: 'Open' });
    expect(within(open).getAllByRole('listitem')).toHaveLength(3);
    const earlier = within(screen.getByRole('list', { name: 'Earlier' })).getAllByRole('link');
    expect(earlier).toHaveLength(8);
    expect(earlier.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Under decision'),
      expect.stringContaining('Under decision'),
      expect.stringContaining(
        'A law-enforcement agency was granted access on 6 Sep 2026 (Asset Recovery Agency, case ARA/INV/2026/014)',
      ),
      expect.stringContaining('Partially granted'),
      expect.stringContaining('Denied'),
      expect.stringContaining('Granted'),
      expect.stringContaining('Withdrawn'),
      expect.stringContaining(
        'A law-enforcement agency was partially granted access on 15 May 2026 (Directorate of Criminal Investigations, case DCI/ECU/2026/0331)',
      ),
    ]);
    expect(earlier[3]?.getAttribute('href')).toBe(`/access/notices/${IDS.partial}`);
    expect(earlier[3]?.textContent).toContain('Decided 2 Sep 2026');
    // A decided row keeps what was asked for, as an open one shows it.
    expect(earlier[3]?.textContent).toMatch(/\d{4}(, \d{4})* · You[^·]* · [A-Z]/);
  });

  it('shows a law-enforcement grant by agency, case, outcome and dates only', async () => {
    const notices = await seededNotices();
    render(<NoticesList notices={notices} page={1} now={NOW} onPage={vi.fn()} />);
    const rows = within(screen.getByRole('list', { name: 'Earlier' })).getAllByRole('link');
    const granted = rows.find((row) => row.getAttribute('href') === `/access/notices/${IDS.lea}`);
    const partial = rows.find(
      (row) => row.getAttribute('href') === `/access/notices/${IDS.leaPartial}`,
    );
    expect(granted?.textContent).toBe(
      'A law-enforcement agency was granted access on 6 Sep 2026 (Asset Recovery Agency, case ARA/INV/2026/014)' +
        'LEA-TSC-2026-0000007-E · Notified 6 Sep 2026' +
        'Granted',
    );
    expect(partial?.textContent).toMatch(/· Notified 15 May 2026Partially granted$/);
    expect(granted?.getAttribute('aria-label')).toBe(
      'Open law-enforcement request LEA-TSC-2026-0000007-E',
    );
    const formK = rows.find((row) => row.getAttribute('href') === `/access/notices/${IDS.partial}`);
    expect(formK?.getAttribute('aria-label')).toMatch(/^Open access request ARQ-/);
  });

  it('calls them all access requests when none is open, and says when there are none', async () => {
    const decided = (await seededNotices()).filter(
      (notice) => notice.kind === 'lea' || !notice.canRespond,
    );
    const { unmount } = render(
      <NoticesList notices={decided} page={1} now={NOW} onPage={vi.fn()} />,
    );
    expect(screen.getByRole('list', { name: 'All access requests' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Open' })).toBeNull();
    unmount();
    render(<NoticesList notices={[]} page={1} now={NOW} onPage={vi.fn()} />);
    expect(screen.getByText('No access requests')).toBeTruthy();
    expect(
      screen.getByText('If someone asks to see your declaration, we will SMS and email you.'),
    ).toBeTruthy();
  });
});
