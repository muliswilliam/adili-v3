// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  DeclarationProgress,
  DeclarationsResult,
  ProgressRow,
} from '../../server/declarations/client';
import { CoverageView, type CoverageViewProps } from './coverage-view';
import { PROGRESS_PAGE_SIZE } from './declaration-progress';

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));

type Cycle = DeclarationProgress['cycle'];

const CYCLE_2025: Cycle = {
  key: 'biennial:2025',
  statementDate: '2025-11-01',
  dueDate: '2025-12-31',
  opensOn: '2025-07-04',
  opened: true,
};

const CYCLE_2027: Cycle = {
  key: 'biennial:2027',
  statementDate: '2027-11-01',
  dueDate: '2027-12-31',
  opensOn: '2027-07-04',
  opened: false,
};

function row(name: string | null, counts: Partial<ProgressRow['counts']> = {}): ProgressRow {
  return {
    reportingEntity: name === null ? null : { id: `id-${name}`, name },
    counts: { notStarted: 0, inProgress: 0, submitted: 0, late: 0, ...counts },
  };
}

const rows = [
  row('Ministry of Health', { notStarted: 6, inProgress: 4, submitted: 12, late: 2 }),
  row('State Department for Public Service', { notStarted: 15, inProgress: 7, submitted: 21 }),
  row(null, { notStarted: 1 }),
];

function ok(entities = rows, cycle = CYCLE_2025): DeclarationsResult<DeclarationProgress> {
  const total = { notStarted: 0, inProgress: 0, submitted: 0, late: 0 };
  for (const entity of entities) {
    total.notStarted += entity.counts.notStarted;
    total.inProgress += entity.counts.inProgress;
    total.submitted += entity.counts.submitted;
    total.late += entity.counts.late;
  }
  return {
    ok: true,
    data: {
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      cycle,
      cycles: [CYCLE_2025, CYCLE_2027],
      reportingEntities: entities,
      total,
    },
  };
}

function renderView(overrides: Partial<CoverageViewProps> = {}) {
  const onSearchChange = vi.fn();
  const onRefresh = vi.fn();
  render(
    <CoverageView
      result={ok()}
      search={{}}
      onSearchChange={onSearchChange}
      loadedAt="2026-10-03T07:30:00Z"
      refreshing={false}
      onRefresh={onRefresh}
      {...overrides}
    />,
  );
  return { onSearchChange, onRefresh };
}

/** The table's head (0), body (1) or foot (2). */
function rowGroup(index: number): HTMLElement {
  const group = within(screen.getByRole('table')).getAllByRole('rowgroup')[index];
  if (!group) throw new Error(`No row group ${String(index)}`);
  return group;
}

const bodyRows = () => within(rowGroup(1)).getAllByRole('row');
const cells = (r: HTMLElement) =>
  within(r)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('#301 roster coverage', () => {
  it('counts each reporting entity not started, in progress, submitted and late, with totals', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Coverage');
    expect(
      within(rowGroup(0))
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual([
      'Reporting entity',
      'Obligations',
      'Not started',
      'In progress',
      'Submitted',
      'Late',
      'Progress',
    ]);
    expect(bodyRows().map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'Ministry of Health',
      'State Department for Public Service',
      'No reporting entity',
    ]);
    expect(bodyRows().map(cells)).toEqual([
      ['24', '6', '4', '12', '2', ''],
      ['43', '15', '7', '21', '0', ''],
      ['1', '1', '0', '0', '0', ''],
    ]);
    expect(cells(within(rowGroup(2)).getByRole('row'))).toEqual(['68', '22', '11', '33', '2', '']);
    expect(within(rowGroup(2)).getByRole('rowheader').textContent).toBe('Total');
  });

  it("totals the service's counts in the tiles, each a share of the obligations", () => {
    renderView();
    const tiles = screen.getByRole('region', { name: 'Declaration progress' });
    expect(tiles.textContent).toContain('Not started22 32%');
    expect(tiles.textContent).toContain('In progress11 16%');
    expect(tiles.textContent).toContain('Submitted33 48%');
    expect(tiles.textContent).toContain('Late2 2%');
  });

  it('draws each row as shares submitted, in progress and late', () => {
    renderView();
    const [health] = bodyRows();
    if (!health) throw new Error('No rows');
    expect(within(health).getByRole('img').getAttribute('aria-label')).toBe(
      '50% submitted, 16% in progress, 8% late',
    );
  });

  it('shows the matching reporting entities and their total when searching', () => {
    renderView({ search: { search: 'health' } });
    expect(bodyRows().map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'Ministry of Health',
    ]);
    expect(within(rowGroup(2)).getByRole('rowheader').textContent).toBe('Total, 1 matching');
    expect(cells(within(rowGroup(2)).getByRole('row'))).toEqual(['24', '6', '4', '12', '2', '']);
  });

  it('offers to clear a search that matches nothing', () => {
    const { onSearchChange } = renderView({ search: { search: 'county' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.body.textContent).toContain('No matches');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('shows the cycle counted in the cycle select', () => {
    renderView();
    expect(screen.getByRole('combobox', { name: 'Cycle' }).textContent).toBe('Biennial 2025');
  });

  it('says when the cycle counted opens, until it has', () => {
    renderView({ result: ok(rows, CYCLE_2027) });
    expect(screen.getByRole('combobox', { name: 'Cycle' }).textContent).toBe(
      'Biennial 2027 (opens 4 Jul 2027)',
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Biennial 2027 opens on 4 Jul 2027. Until then, counts cover initial and final declarations.',
    );
  });

  it('says when the counts were read, and reads them again on Refresh', () => {
    const { onRefresh } = renderView();
    expect(document.body.textContent).toContain('Updated 10:30');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh counts' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('says it is updating while the counts are read again', () => {
    renderView({ refreshing: true });
    expect(document.body.textContent).toContain('Updating…');
    expect(screen.getByRole('button', { name: 'Refresh counts' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('pages a long list', () => {
    const many = Array.from({ length: PROGRESS_PAGE_SIZE + 2 }, (_, index) =>
      row(`Entity ${String(index).padStart(2, '0')}`, { notStarted: 1 }),
    );
    const { onSearchChange } = renderView({ result: ok(many), search: { page: 2 } });
    expect(bodyRows()).toHaveLength(2);
    const pager = screen.getByRole('navigation', { name: 'Reporting entity pages' });
    expect(pager.textContent).toContain(`26-27 of ${String(PROGRESS_PAGE_SIZE + 2)}`);
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('says nothing is due yet when the cycle counts no obligation', () => {
    renderView({ result: ok([], CYCLE_2027) });
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.body.textContent).toContain('Nothing due in Biennial 2027 yet');
    expect(document.body.textContent).toContain('Obligations open on 4 Jul 2027.');
    // Said once: no notice above the empty state.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says nobody has an obligation in an opened cycle that counts none', () => {
    renderView({ result: ok([]) });
    expect(document.body.textContent).toContain(
      'No declarants have an obligation in this cycle right now.',
    );
  });

  it('waits for a roster before counting', () => {
    renderView({ noRoster: true, noRosterAction: <button type="button">Import roster</button> });
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.body.textContent).toContain('Coverage appears once the roster is imported.');
    expect(screen.getByRole('button', { name: 'Import roster' })).toBeTruthy();
  });

  it('shows a loading table', () => {
    renderView({ result: null });
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
  });

  it('offers a retry when the counts could not be loaded', () => {
    renderView({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(document.body.textContent).toContain('Counts could not be loaded');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('reads as not found when the service does not show the counts (404)', () => {
    renderView({
      result: {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Not Found', status: 404 },
        },
      },
    });
    expect(document.body.textContent).toContain('Page not found');
    expect(screen.queryByRole('button', { name: 'Refresh counts' })).toBeNull();
  });
});
