// @vitest-environment jsdom
import { COMMISSION_ADMIN, EACC_ANALYST, REPORTING_OFFICER } from '@adili/roles';
import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { OpenDataPreviewLoad } from '../../server/open-data-preview';
import { loadCommissionOpenDataPreview } from '../../server/open-data-preview.server';
import { buildOpenDataSnapshot } from '../../server/open-data-releases.server';
import {
  mockReportingClient,
  resetReportingMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import { resetNcrMock } from '../../server/reporting/ncr-mock.server';
import {
  type ReleasesMockSeed,
  resetReleasesMock,
} from '../../server/reporting/releases-mock.server';
import { noAccessText, OpenDataPreview } from './open-data-preview';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const PUBLIC_PAGE = 'http://portal.test/open-data';

beforeAll(() => {
  setReportingMockLatency(0);
});
afterAll(() => {
  setReportingMockLatency(1);
});

/**
 * What EACC has done in the releases mock: `published`, FY 2025/2026's annual release, published
 * on the NCR's approval; `history`, that year's mid-year snapshots only; `preview`, the history
 * and a FY 2026/2027 snapshot built since; `none` and `unavailable`, those seeds.
 */
type Releases = 'published' | 'preview' | Exclude<ReleasesMockSeed, 'documents-unavailable'>;

/** The page as the route renders it, for `tenant`'s admin, from the mock through the real loader. */
async function renderPreview(
  releases: Releases,
  { tenant = 'tsc', roles = [COMMISSION_ADMIN] }: { tenant?: string; roles?: string[] } = {},
) {
  resetReportingMock('2026-10-03');
  resetNcrMock(releases === 'published' ? 'approved' : 'not-built');
  resetReleasesMock(releases === 'published' || releases === 'preview' ? 'history' : releases);
  if (releases === 'preview') {
    const analyst = mockReportingClient([EACC_ANALYST], { tenant: 'eacc' });
    if (!(await buildOpenDataSnapshot(analyst, 2026, crypto.randomUUID())).ok) {
      throw new Error('The FY 2026/2027 snapshot did not build');
    }
  }
  const load: OpenDataPreviewLoad = {
    preview: await loadCommissionOpenDataPreview(mockReportingClient(roles, { tenant }), tenant),
    publicPageUrl: PUBLIC_PAGE,
  };
  return render(<OpenDataPreview load={load} />);
}

const region = (name: string) => screen.getByRole('region', { name });
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item ${String(index)}`);
  return item;
}
const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('the Commission open-data preview (spec 09b S6)', () => {
  it('shows the latest published release it comes from, with a link to the public page', async () => {
    await renderPreview('published');
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('FY 2025/2026 annual v1').closest('p')?.textContent).toBe(
      'From FY 2025/2026 annual v1 · Published 25 Sep 2026',
    );
    expect(screen.getByRole('link', { name: /Public page/ }).getAttribute('href')).toBe(
      PUBLIC_PAGE,
    );
  });

  it("shows the Commission's declarations by cycle, the total last", async () => {
    await renderPreview('published');
    const rows = within(region('Declarations')).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Initial',
      'Biennial',
      'Final',
      'All cycles',
    ]);
    expect(cellsOf(at(rows, 0))).toEqual(['9,412', '8,960', '452', '95.2%']);
    expect(cellsOf(at(rows, 3))).toEqual(['23,187', '22,173', '1,014', '95.6%']);
    // Rates keep one decimal so the column lines up.
    expect(cellsOf(at(rows, 2))).toEqual(['905', '811', '94', '89.6%']);
  });

  it('lists compliance figures and access requests', async () => {
    await renderPreview('published');
    const compliance = region('Compliance');
    expect(
      cellsOf(within(compliance).getByRole('row', { name: /Determinations: compliant/ })),
    ).toEqual(['6,874']);
    expect(cellsOf(within(compliance).getByRole('row', { name: /Referrals/ }))).toEqual(['10']);
    const access = region('Access requests');
    expect(
      within(access)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual(['Received0', 'Granted0', 'Declined0']);
  });

  it('explains the markers it shows in the legend', async () => {
    await renderPreview('published');
    const legend = screen.getByRole('note');
    expect(legend.textContent).toContain('are not shown to protect privacy.');
    expect(legend.textContent).not.toContain('Not collected yet');
    expect(legend.textContent).not.toContain('Protects privacy');
  });

  it('shows a preview as not public yet, with suppressed figures marked and nothing expected left out', async () => {
    // EACC builds it now: the day it says it was built.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-03T09:00:00Z') });
    try {
      await renderPreview('preview', { tenant: 'cpsb042' });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByText('FY 2026/2027 snapshot v1').closest('p')?.textContent).toBe(
      'From FY 2026/2027 snapshot v1 · Built 3 Oct 2026 · Not public yet',
    );
    expect(screen.queryByRole('link', { name: /Public page/ })).toBeNull();
    const rows = within(region('Declarations')).getAllByRole('row').slice(1);
    // An even year: no biennial cycle.
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Initial',
      'Final',
      'All cycles',
    ]);
    // The initial cycle is under 10 officers; the final one is hidden with it, so the total,
    // a true sum, gives neither away.
    const marker = at(within(at(rows, 0)).getAllByText('‹10'), 0).parentElement;
    expect(marker?.getAttribute('data-unshown')).toBe('suppressed');
    expect(marker?.textContent).toBe('‹10Not shown to protect privacy');
    expect(within(at(rows, 1)).getAllByText('‹10')).toHaveLength(4);
    expect(cellsOf(at(rows, 2))).toEqual(['30', '26', '4', '86.7%']);
    expect(cellsOf(within(region('Compliance')).getByRole('row', { name: /Referrals/ }))).toEqual([
      '0',
    ]);
    const legend = screen.getByRole('note');
    expect(legend.textContent).toContain('8 hidden');
    expect(legend.textContent).toContain('Protects privacy');
  });

  it('marks the figures of a Commission that has not reported', async () => {
    // PSC had not reported when FY 2025/2026's national report was built.
    await renderPreview('published', { tenant: 'psc' });
    const rows = within(region('Declarations')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(within(at(rows, 3)).getAllByText('Not reported')).toHaveLength(4);
    expect(within(region('Access requests')).getAllByText('Not reported')).toHaveLength(3);
    expect(screen.getByRole('note').textContent).toContain('Commission has not reported');
  });

  it('says there is no open data yet while no release has been built', async () => {
    await renderPreview('none');
    expect(screen.getByText('No open-data release yet')).toBeTruthy();
    expect(screen.getByText('Your figures appear here when EACC builds a release.')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('offers a retry when the figures could not be loaded', async () => {
    await renderPreview('unavailable');
    expect(screen.getByText('We could not load your open-data figures')).toBeTruthy();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(invalidate).toHaveBeenCalled();
  });

  it("tells the Commission's other staff the page is for its administrator", async () => {
    await renderPreview('published', { roles: [REPORTING_OFFICER] });
    expect(screen.getByText('This page is for your Commission administrator.')).toBeTruthy();
  });

  it('shows a skeleton while loading', () => {
    render(<OpenDataPreview load={null} />);
    expect(screen.getByRole('status', { busy: true })).toBeTruthy();
  });
});

describe('who the page is not for', () => {
  it('sends EACC to its Open data and tells anyone else the page is for the administrator', () => {
    expect(noAccessText(['eacc-analyst'])).toBe('EACC sees every Commission in Open data.');
    expect(noAccessText(['eacc-supervisor'])).toBe('EACC sees every Commission in Open data.');
    expect(noAccessText(['reporting-officer', 'reviewer'])).toBe(
      'This page is for your Commission administrator.',
    );
  });
});
