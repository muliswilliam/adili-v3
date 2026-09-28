// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  DeclarationsResult,
  NationalCommissionRow,
  NationalObligationsSummary,
} from '../../server/declarations/client';
import { NATIONAL_PAGE_SIZE } from './national-summary';
import { NationalView, type NationalViewProps } from './national-view';

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));

const JUNE_2027 = Date.parse('2027-06-01T09:00:00Z');
const AUGUST_2027 = Date.parse('2027-08-01T09:00:00Z');

function row(
  slug: string,
  name: string,
  counts: Partial<NationalCommissionRow['total']> = {},
  notOnboarded = 0,
  lastRosterImportAt: string | null = null,
): NationalCommissionRow {
  return {
    commission: { slug, issuerCode: slug.toUpperCase(), name },
    total: { upcoming: 0, due: 0, overdue: 0, filed: 0, ...counts },
    notOnboarded,
    lastRosterImportAt,
  };
}

const rows = [
  row('psc', 'Public Service Commission', { due: 47, overdue: 26 }, 48, '2026-09-26T08:00:00Z'),
  row('jsc', 'Judicial Service Commission'),
  row(
    'npsc',
    'National Police Service Commission',
    { due: 812, overdue: 1_406 },
    1_991,
    '2026-09-11T08:00:00Z',
  ),
];

function ok(commissions = rows): DeclarationsResult<NationalObligationsSummary> {
  return {
    ok: true,
    data: {
      cycle: 'biennial:2027',
      commissions,
      totals: commissions.reduce(
        (t, r) => ({
          upcoming: t.upcoming + r.total.upcoming,
          due: t.due + r.total.due,
          overdue: t.overdue + r.total.overdue,
          filed: 0,
        }),
        { upcoming: 0, due: 0, overdue: 0, filed: 0 },
      ),
    },
  };
}

function renderView(overrides: Partial<NationalViewProps> = {}) {
  const onSearchChange = vi.fn();
  render(
    <NationalView
      result={ok()}
      search={{}}
      onSearchChange={onSearchChange}
      commissionLink={(r) => <a href={`/commissions/${r.commission.slug}`}>{r.commission.name}</a>}
      today={JUNE_2027}
      {...overrides}
    />,
  );
  return { onSearchChange };
}

/** The table's head (0), body (1) or foot (2). */
function rowGroup(index: number): HTMLElement {
  const group = within(screen.getByRole('table')).getAllByRole('rowgroup')[index];
  if (!group) throw new Error(`No row group ${String(index)}`);
  return group;
}

const bodyRows = () => within(rowGroup(1)).getAllByRole('row');

describe('S16 national summary (EACC, platform admin)', () => {
  it('lists Commissions most overdue first, with counts, last import and totals', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('National obligations');
    expect(document.body.textContent).toContain('Biennial 2027 · due 31 Dec 2027');
    expect(
      bodyRows().map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['0', '812', '1,406', '1,991', '11 Sep 2026'],
      ['0', '47', '26', '48', '26 Sep 2026'],
      ['0', '0', '0', '0', 'No roster yet'],
    ]);
    expect(bodyRows().map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'National Police Service CommissionNPSC',
      'Public Service CommissionPSC',
      'Judicial Service CommissionJSC',
    ]);
    const table = screen.getByRole('table');
    expect(within(rowGroup(2)).getByRole('row').textContent).toBe(
      'Total, 3 Commissions08591,4322,039',
    );
    expect(
      within(table)
        .getByRole('columnheader', { name: /Overdue/ })
        .getAttribute('aria-sort'),
    ).toBe('descending');
    expect(within(table).getByRole('link', { name: 'Public Service Commission' })).toBeTruthy();
  });

  it('sorts when a column header is pressed', () => {
    const { onSearchChange } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Commission' }));
    expect(onSearchChange).toHaveBeenCalledWith({ sort: 'name' });
  });

  it('shows the order from the URL', () => {
    renderView({ search: { sort: 'name' } });
    expect(bodyRows().map((r) => within(r).getByRole('link').textContent)).toEqual([
      'Judicial Service Commission',
      'National Police Service Commission',
      'Public Service Commission',
    ]);
    expect(screen.getByRole('columnheader', { name: /Commission/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
  });

  it('says when the biennial cycle opens, until it has', () => {
    renderView();
    expect(screen.getByRole('status').textContent).toBe(
      'Biennial 2027 opens on 4 Jul 2027. Until then, counts cover initial and final declarations.',
    );
  });

  it('drops the notice once the cycle has opened', () => {
    renderView({ today: AUGUST_2027 });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pages a long list', () => {
    const many = Array.from({ length: NATIONAL_PAGE_SIZE + 2 }, (_, index) =>
      row(`c${String(index).padStart(2, '0')}`, `Commission ${String(index).padStart(2, '0')}`, {
        due: index,
      }),
    );
    const { onSearchChange } = renderView({ result: ok(many), search: { page: 2 } });
    expect(bodyRows()).toHaveLength(2);
    const pager = screen.getByRole('navigation', { name: 'Commission pages' });
    expect(pager.textContent).toContain(`26-27 of ${NATIONAL_PAGE_SIZE + 2}`);
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('shows a loading table', () => {
    renderView({ result: null });
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
  });

  it('says no Commission has obligations yet', () => {
    renderView({ result: ok([row('jsc', 'Judicial Service Commission')]) });
    expect(document.body.textContent).toContain('No Commission has obligations yet.');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers a retry when the summary could not be loaded', () => {
    renderView({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(document.body.textContent).toContain('National obligations could not be loaded');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('tells Commission staff it is not theirs (403)', () => {
    renderView({
      result: {
        ok: false,
        error: { kind: 'problem', problem: { type: 'about:blank', title: 'No', status: 403 } },
      },
      forbiddenAction: <a href="/obligations">Open your Commission&apos;s obligations</a>,
    });
    expect(screen.getByRole('status').textContent).toContain(
      'You do not have access to national obligations.',
    );
    expect(screen.getByRole('link', { name: "Open your Commission's obligations" })).toBeTruthy();
  });
});
