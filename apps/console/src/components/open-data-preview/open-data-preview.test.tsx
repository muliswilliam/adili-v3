// @vitest-environment jsdom
import { COMMISSION_ADMIN, REPORTING_OFFICER } from '@adili/roles';
import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { OpenDataPreviewLoad } from '../../server/open-data-preview';
import { loadCommissionOpenDataPreview } from '../../server/open-data-preview.server';
import {
  mockReportingClient,
  resetReportingMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import type { OpenDataMockScenario } from '../../server/reporting/open-data-mock.server';
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

/** The page as the route renders it, for `tenant`'s admin, from the mock through the real loader. */
async function renderPreview(
  scenario: OpenDataMockScenario,
  { tenant = 'psc', roles = [COMMISSION_ADMIN] }: { tenant?: string; roles?: string[] } = {},
) {
  resetReportingMock('2026-10-03', { openData: scenario });
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
      'From FY 2025/2026 annual v1 · Published 18 Sep 2026',
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
    expect(cellsOf(at(rows, 0))).toEqual(['2,920', '2,808', '112', '96.2%']);
    expect(cellsOf(at(rows, 3))).toEqual(['50,312', '48,879', '1,433', '97.2%']);
    // Rates keep one decimal so the column lines up.
    expect(cellsOf(at(rows, 2))).toEqual(['912', '861', '51', '94.4%']);
  });

  it('lists compliance figures and access requests', async () => {
    await renderPreview('published');
    const compliance = region('Compliance');
    expect(
      cellsOf(within(compliance).getByRole('row', { name: /Determinations: compliant/ })),
    ).toEqual(['16,054']);
    expect(cellsOf(within(compliance).getByRole('row', { name: /Referrals/ }))).toEqual(['61']);
    const access = region('Access requests');
    expect(
      within(access)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual(['Received14', 'Granted11', 'Declined3']);
  });

  it('explains the markers it shows in the legend', async () => {
    await renderPreview('published');
    const legend = screen.getByRole('note');
    expect(legend.textContent).toContain('are not shown to protect privacy.');
    expect(legend.textContent).not.toContain('Not collected yet');
    expect(legend.textContent).not.toContain('Protects privacy');
  });

  it('shows a preview as not public yet, with suppressed figures marked and nothing expected left out', async () => {
    await renderPreview('preview');
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByText('FY 2026/2027 snapshot v1').closest('p')?.textContent).toBe(
      'From FY 2026/2027 snapshot v1 · Built 26 Sep 2026 · Not public yet',
    );
    expect(screen.queryByRole('link', { name: /Public page/ })).toBeNull();
    const rows = within(region('Declarations')).getAllByRole('row').slice(1);
    // An even year: no biennial cycle.
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Initial',
      'Final',
      'All cycles',
    ]);
    // The final cycle is under 10 officers; the initial one is hidden with it, so the total,
    // a true sum, gives neither away.
    const marker = at(within(at(rows, 1)).getAllByText('‹10'), 0).parentElement;
    expect(marker?.getAttribute('data-unshown')).toBe('suppressed');
    expect(marker?.textContent).toBe('‹10Not shown to protect privacy');
    expect(within(at(rows, 0)).getAllByText('‹10')).toHaveLength(4);
    expect(cellsOf(at(rows, 2))).toEqual(['663', '602', '61', '90.8%']);
    expect(cellsOf(within(region('Compliance')).getByRole('row', { name: /Referrals/ }))).toEqual([
      '3',
    ]);
    const legend = screen.getByRole('note');
    expect(legend.textContent).toContain('8 hidden');
    expect(legend.textContent).toContain('Protects privacy');
  });

  it('marks the figures of a Commission that has not reported', async () => {
    await renderPreview('published', { tenant: 'nlc' });
    const rows = within(region('Declarations')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(within(at(rows, 3)).getAllByText('Not reported')).toHaveLength(4);
    expect(within(region('Access requests')).getAllByText('Not reported')).toHaveLength(3);
    expect(screen.getByRole('note').textContent).toContain('Commission has not reported');
  });

  it('says there is no open data yet while no release has been built', async () => {
    await renderPreview('none');
    expect(screen.getByText('No open data yet')).toBeTruthy();
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
