// @vitest-environment jsdom
import { EACC_ANALYST } from '@adili/roles';
import { TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadIntake } from '../../server/eacc-intake.server';
import type { IntakePage } from '../../server/eacc-intake';
import { setEaccIntakeMockLatency } from '../../server/reporting/eacc-mock.server';
import {
  mockReportingClient,
  resetReportingMock,
  submitMockReport,
} from '../../server/reporting/mock.server';
import { IntakeDashboard, type IntakeSearch } from './intake-dashboard';

const invalidate = vi.fn(() => Promise.resolve());
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const TODAY = '2026-10-03';

beforeAll(() => {
  setEaccIntakeMockLatency(0);
  // Radix Select needs pointer capture, which jsdom lacks.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});
afterAll(() => {
  setEaccIntakeMockLatency(1);
});
beforeEach(() => {
  invalidate.mockClear();
  resetReportingMock(TODAY);
  // The Public Service Commission files on 28 July, on time (spec 09 S9).
  submitMockReport(2025, '2026-07-28');
});

async function page(fy = 2025): Promise<IntakePage> {
  const client = mockReportingClient([EACC_ANALYST], { tenant: 'eacc' });
  return { today: TODAY, fy, intake: await loadIntake(client, fy) };
}

function show(result: IntakePage | null, search: IntakeSearch = {}) {
  const onSearchChange = vi.fn();
  render(
    <TooltipProvider>
      <IntakeDashboard
        result={result}
        search={search}
        onSearchChange={onSearchChange}
        reportLink={(row, children) => (
          <a href={`/eacc/reports/${row.reportId ?? ''}`}>{children}</a>
        )}
      />
    </TooltipProvider>,
  );
  return { onSearchChange };
}

const rowOf = (name: string) => {
  const cell = screen.getByRole('rowheader', { name: new RegExp(name) });
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
};

describe('the EACC intake dashboard (S9, S10, S15)', () => {
  it('shows a loading skeleton while the intake loads', () => {
    show(null);
    expect(screen.getByRole('heading', { name: 'Compliance reports' })).toBeTruthy();
    expect(screen.getByLabelText('Loading the intake').getAttribute('aria-busy')).toBe('true');
  });

  it('offers a retry when the intake could not load', () => {
    show({
      today: TODAY,
      fy: 2025,
      intake: { ok: false, error: { kind: 'unavailable', detail: null } },
    });
    expect(screen.getByText('We could not load the intake')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('tells anyone but EACC staff the page is not theirs (403)', () => {
    show({
      today: TODAY,
      fy: 2025,
      intake: {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
        },
      },
    });
    expect(screen.getByText('This page is for EACC analysts and supervisors.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the year in tiles: on time, late, not reported with the next chase, and the national rate', async () => {
    show(await page());
    const tiles = within(screen.getByRole('region', { name: 'Reports for the year' }));
    expect(tiles.getByText('Reported on time').parentElement?.textContent).toContain('9');
    expect(tiles.getByText('Reported late').parentElement?.textContent).toContain('3');
    expect(tiles.getByText('Not reported').parentElement?.textContent).toContain('3');
    expect(tiles.getByText('Next chase 10 Oct 2026')).toBeTruthy();
    expect(tiles.getByText('National declared rate').parentElement?.textContent).toMatch(
      /\d+(\.\d)?%/,
    );
  });

  it('lists each Commission with its status, reference, section rates and outliers', async () => {
    // By name: the Public Service and Teachers Service Commissions are on the second page.
    show(await page(), { page: 2 });
    const psc = rowOf('Public Service Commission');
    expect(psc.getByText('Reported on time')).toBeTruthy();
    expect(psc.getByText('RPT-PSC-2026-0000001-K')).toBeTruthy();
    expect(psc.getByText('83.3%')).toBeTruthy();
    expect(psc.getByText('10 of 12')).toBeTruthy();
    expect(psc.getByText('Low final rate')).toBeTruthy();
    expect(
      psc.getByRole('link', { name: 'Open the report of Public Service Commission' }),
    ).toBeTruthy();

    const tsc = rowOf('Teachers Service Commission');
    expect(tsc.getByText('Reported late')).toBeTruthy();
    expect(tsc.getByText('Chased 2 times, last 8 Aug 2026')).toBeTruthy();
  });

  it('shows a Commission that has not reported with its chases (S10) and no rates', async () => {
    show(await page());
    const jsc = rowOf('Judicial Service Commission');
    expect(jsc.getByText('Not reported')).toBeTruthy();
    expect(jsc.getByText('Chased 10 times, last 3 Oct 2026')).toBeTruthy();
    expect(jsc.queryByRole('link')).toBeNull();
    expect(
      jsc.getByRole('button', { name: 'Chase history of Judicial Service Commission' }),
    ).toBeTruthy();
  });

  it('opens the chase history of a Commission that has not reported', async () => {
    show(await page());
    fireEvent.click(
      screen.getByRole('button', { name: 'Chase history of Judicial Service Commission' }),
    );
    const drawer = within(screen.getByRole('dialog', { name: 'Judicial Service Commission' }));
    expect(drawer.getByText('Chase history, FY 2025/2026')).toBeTruthy();
    expect(drawer.getByText('Reminders sent').nextElementSibling?.textContent).toBe('10');
    expect(drawer.getByText('3 Oct 2026, 06:00')).toBeTruthy();
    expect(drawer.getByText('10 Oct 2026')).toBeTruthy();
    expect(drawer.getByText('31 Jul 2026')).toBeTruthy();
  });

  it('counts every status on the chips and filters by status', async () => {
    const { onSearchChange } = show(await page());
    const chips = within(screen.getByRole('group', { name: 'Filter by status' }));
    expect(chips.getByRole('button', { name: /^All 15/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(chips.getByRole('button', { name: /^Late 3/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ fy: 2025, status: 'submitted-late' });
  });

  it('shows only the filtered Commissions', async () => {
    show(await page(), { status: 'not-reported' });
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Judicial Service Commission',
      'Kisii County Public Service Board',
      'Kisumu County Public Service Board',
    ]);
  });

  it('shows outliers only when asked', async () => {
    const { onSearchChange } = show(await page(), { outliers: true });
    const names = screen.getAllByRole('rowheader').map((cell) => cell.textContent);
    expect(names).toHaveLength(4);
    expect(names.some((name) => name.startsWith('Public Service Commission'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Outliers only/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ fy: 2025 });
  });

  it('says when no Commission matches, with a way to clear the filters', async () => {
    const { onSearchChange } = show(await page(), { q: 'Anti-Doping', status: 'submitted-late' });
    expect(screen.getByText('No Commissions match these filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onSearchChange).toHaveBeenCalledWith({ fy: 2025 });
  });

  it('pages ten Commissions at a time', async () => {
    const { onSearchChange } = show(await page(), { page: 2 });
    expect(screen.getAllByRole('rowheader')).toHaveLength(5);
    expect(screen.getByText('11-15 of 15')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onSearchChange).toHaveBeenCalledWith({ fy: 2025 });
  });

  it('waits for the year still running, with every Commission not reported', async () => {
    show(await page(2026));
    expect(screen.getByText('No reports for FY 2026/2027 yet')).toBeTruthy();
    expect(screen.getByText('Due 31 Jul 2027.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('switches the financial year', async () => {
    const { onSearchChange } = show(await page());
    const select = screen.getByRole('combobox', { name: 'Financial year' });
    expect(select.textContent).toContain('FY 2025/2026 (due 31 Jul 2026)');
    fireEvent.keyDown(select, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'FY 2026/2027 (current)' }));
    expect(onSearchChange).toHaveBeenCalledWith({ fy: 2026 });
  });
});
