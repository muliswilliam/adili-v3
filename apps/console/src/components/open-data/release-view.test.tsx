// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOpenDataSnapshot, loadOpenDataRelease } from '../../server/open-data-releases.server';
import type { PublicLinks } from '../../server/open-data-releases';
import {
  mockReportingClient,
  resetReportingMock as resetFormMMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import { setEaccIntakeMockLatency } from '../../server/reporting/eacc-mock.server';
import { resetNcrMock } from '../../server/reporting/ncr-mock.server';
import { resetReleasesMock } from '../../server/reporting/releases-mock.server';
import { ReleaseView } from './release-view';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const analyst = () =>
  mockReportingClient(['eacc-analyst'], {
    name: 'Brian Otieno',
    subject: 'user-brian-otieno',
    tenant: 'eacc',
  });

const NO_LINKS: PublicLinks = { publicPage: null, verifyBase: null };

async function preview2026() {
  const built = await buildOpenDataSnapshot(analyst(), 2026, crypto.randomUUID());
  if (!built.ok) throw new Error('build failed');
  return loadOpenDataRelease(analyst(), built.data.id);
}

function renderView(
  result: Awaited<ReturnType<typeof loadOpenDataRelease>> | null,
  links = NO_LINKS,
) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <ReleaseView result={result} links={links} />
      </ToastProvider>
    </TooltipProvider>,
  );
}

const tablePanel = () => screen.getByRole('tabpanel');

beforeEach(() => {
  // FY 2025/2026's reports are in, FY 2026/2027's not due.
  resetFormMMock('2026-10-03');
  setReportingMockLatency(0);
  setEaccIntakeMockLatency(0);
  resetNcrMock('not-built');
  resetReleasesMock('history');
});

describe('#350 snapshot preview', () => {
  it('heads the preview with its status, version, who built it and that it is not public', async () => {
    renderView(await preview2026());

    expect(screen.getByRole('heading', { level: 1, name: 'FY 2026/2027 snapshot' })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('Preview');
    expect(main.textContent).toContain('Version 1');
    expect(main.textContent).toContain('by Brian Otieno');
    expect(screen.getByText('Not public. An EACC supervisor publishes it.')).toBeTruthy();
    expect(screen.getByText('Issued as a Public verifiable document when published.')).toBeTruthy();
  });

  it('S9 says the totals reconcile with the projections the snapshot was built from', async () => {
    renderView(await preview2026());

    expect(
      screen.getByText(
        'Totals match the Form M projections at build: 9,760 of 10,947 declarations.',
      ),
    ).toBeTruthy();
  });

  it('S9 names the approved NCR an annual release reconciles with', async () => {
    resetNcrMock('approved');
    resetReleasesMock('history');
    const annual = await loadOpenDataRelease(analyst(), '0199c000-0000-7000-8000-000000000003');

    renderView(annual);

    const reference = screen.getByText(/^NCR-EACC-2026-0000001-.$/);
    expect(reference.closest('p')?.textContent).toMatch(
      /^Totals match NCR-EACC-2026-0000001-.: [\d,]+ of [\d,]+ declarations\.$/,
    );
  });

  it('renders all six tables as tabs', async () => {
    renderView(await preview2026());

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual([
      'Declarations by Commission',
      'Compliance by Commission',
      'By reporting entity type',
      'By cycle',
      'Access requests',
      'National totals',
    ]);
  });

  it('S4 shows suppressed figures as ‹10 with the legend and how many are hidden', async () => {
    renderView(await preview2026());
    fireEvent.click(screen.getByRole('radio', { name: 'Final' }));

    const panel = tablePanel();
    const kisii = within(panel).getByRole('row', { name: /Kisii/ });
    expect(within(kisii).getAllByText('Not shown to protect privacy').length).toBeGreaterThan(0);
    expect(within(kisii).getAllByText('‹10').length).toBeGreaterThan(0);
    const legend = within(panel).getByRole('note');
    expect(legend.textContent).toContain('fewer than 10 officers');
    expect(legend.textContent).toMatch(/\d+ hidden/);
  });

  it('S4 counts the hidden figures of the cycle on show', async () => {
    renderView(await preview2026());
    const panel = tablePanel();
    const hidden = () => /(\d+) hidden/.exec(within(panel).getByRole('note').textContent)?.[1];
    // Every figure of a suppressed row is hidden: expected, declared, did not declare, rate.
    const shownRowsHidden = () =>
      within(panel)
        .getAllByRole('row')
        .filter((row) => within(row).queryAllByText('‹10').length === 4).length * 4;

    fireEvent.click(screen.getByRole('radio', { name: 'Final' }));
    const final = hidden();
    expect(Number(final)).toBe(shownRowsHidden());
    fireEvent.click(screen.getByRole('radio', { name: 'All cycles' }));

    expect(Number(hidden() ?? 0)).toBe(shownRowsHidden());
    expect(hidden()).not.toBe(final);
  });

  it('lists every Commission by name, sortable by any column', async () => {
    renderView(await preview2026());

    const panel = tablePanel();
    const firstRow = () => within(panel).getAllByRole('row')[1]?.textContent ?? '';
    // A header row and the 15 Commissions, one page of them.
    expect(within(panel).getAllByRole('row')).toHaveLength(16);
    expect(firstRow()).toContain('Bungoma County Public Service Board');
    fireEvent.click(within(panel).getByRole('button', { name: 'Expected, sort' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Expected, sort' }));
    expect(firstRow()).toContain('Teachers Service Commission');
  });

  it('groups the compliance table under Determinations, Clarifications and Administrative actions', async () => {
    renderView(await preview2026());
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Compliance by Commission' }));

    const panel = tablePanel();
    for (const group of ['Determinations', 'Clarifications', 'Administrative actions']) {
      expect(within(panel).getByRole('columnheader', { name: group })).toBeTruthy();
    }
  });

  it('marks access requests not collected, never as a zero', async () => {
    renderView(await preview2026());
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Access requests' }));

    const panel = tablePanel();
    expect(within(panel).getAllByText('Not collected yet').length).toBeGreaterThan(0);
    expect(within(panel).queryByText('0')).toBeNull();
  });

  it('says no reporting entity types exist yet', async () => {
    renderView(await preview2026());
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'By reporting entity type' }));

    expect(within(tablePanel()).getByText('No reporting entity types yet')).toBeTruthy();
  });

  it('lists the national totals with labels and rates as percentages', async () => {
    renderView(await preview2026());
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'National totals' }));

    const panel = tablePanel();
    const row = within(panel).getByRole('row', { name: /Declarations made/ });
    expect(row.textContent).toContain('9,760');
    expect(within(panel).getByRole('row', { name: /Declaration rate/ }).textContent).toContain(
      '89.2%',
    );
  });

  it("lists the release's files with their rows and hidden figures", async () => {
    renderView(await preview2026());

    const files = screen.getByRole('region', { name: 'Files' });
    expect(files.textContent).toContain('filing-by-commission');
    expect(files.textContent).toContain('60 rows');
  });
});

describe('#350 a published or withdrawn release', () => {
  it('shows a withdrawn release with who withdrew it and why', async () => {
    renderView(await loadOpenDataRelease(analyst(), '0199c000-0000-7000-8000-000000000001'));

    const banner = screen.getByText(/^Withdrawn 19 Feb 2026 by/).closest('[role="alert"]');
    expect(banner?.textContent).toContain('Withdrawn 19 Feb 2026 by Esther Chebet.');
    expect(banner?.textContent).toContain('counted twice');
  });

  it("marks a withdrawn release's manifest revoked, as its verify page shows it", async () => {
    renderView(await loadOpenDataRelease(analyst(), '0199c000-0000-7000-8000-000000000001'));

    const manifest = screen.getByRole('region', { name: 'Manifest' });
    expect(within(manifest).getByText('Revoked')).toBeTruthy();
    expect(within(manifest).queryByText('Public')).toBeNull();
  });

  it("shows a published release's manifest code, with a verify link when the console knows the app", async () => {
    renderView(await loadOpenDataRelease(analyst(), '0199c000-0000-7000-8000-000000000002'), {
      publicPage: null,
      verifyBase: 'http://verify.test',
    });

    const manifest = screen.getByRole('region', { name: 'Manifest' });
    expect(manifest.textContent).toContain('ADL-8KQD-3TWM-6HXC-2RPA-9VNF-4E');
    expect(
      within(manifest)
        .getByRole('link', { name: /Verify/ })
        .getAttribute('href'),
    ).toBe('http://verify.test/v/ADL-8KQD-3TWM-6HXC-2RPA-9VNF-4E');
  });
});

describe('#350 release states', () => {
  it('says a release that does not exist is not found', async () => {
    renderView(await loadOpenDataRelease(analyst(), crypto.randomUUID()));

    expect(screen.getByText('This release does not exist.')).toBeTruthy();
  });

  it('offers a retry when the release could not be loaded', async () => {
    resetReleasesMock('unavailable');
    renderView(await loadOpenDataRelease(analyst(), crypto.randomUUID()));

    expect(screen.getByText('We could not load the release')).toBeTruthy();
  });

  it('shows placeholders while the release loads', () => {
    renderView(null);

    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
  });
});
