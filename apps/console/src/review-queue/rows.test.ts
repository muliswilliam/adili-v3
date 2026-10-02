import { describe, expect, it } from 'vitest';

import { caseItem, ME, WAFULA } from '../review-case/fixtures';
import { clarificationCell, type QueueSummary, rowAction, rowMenu, tileCount } from './rows';

const bands = (high: number, medium: number, low: number) => ({ high, medium, low });

const SUMMARY: QueueSummary = {
  byStatus: { unassigned: 1287, 'awaiting-clarification': 154 },
  byBand: bands(92, 494, 913),
  byStatusAndBand: {
    unassigned: bands(62, 399, 826),
    assigned: bands(4, 5, 3),
    'awaiting-clarification': bands(24, 75, 55),
    clarified: bands(0, 0, 0),
    'ready-for-determination': bands(3, 20, 34),
    'sample-review': bands(0, 0, 0),
    'further-action': bands(0, 0, 0),
    determined: bands(0, 0, 0),
  },
  mine: bands(3, 4, 2),
  overdueClarifications: 1,
};

describe('tileCount', () => {
  it('totals a status tile and splits it by priority, highest first', () => {
    expect(tileCount(SUMMARY, 'unassigned')).toEqual({
      total: 1287,
      bands: [
        { band: 'high', value: 62 },
        { band: 'medium', value: 399 },
        { band: 'low', value: 826 },
      ],
    });
  });

  it("counts the viewer's own cases for Mine", () => {
    expect(tileCount(SUMMARY, 'mine').total).toBe(9);
  });

  it('reads a status the service left out as none', () => {
    const rest = { ...SUMMARY.byStatusAndBand };
    delete rest['ready-for-determination'];
    expect(tileCount({ ...SUMMARY, byStatusAndBand: rest }, 'ready-for-determination').total).toBe(
      0,
    );
  });
});

describe('clarificationCell', () => {
  const at = (status: Parameters<typeof clarificationCell>[0]['clarification']['status']) => ({
    clarification: { open: 0, status, dueAt: '2026-10-08T09:00:00Z' },
  });

  it.each([
    [null, { kind: 'none' }],
    ['resolved', { kind: 'none' }],
    ['withdrawn', { kind: 'none' }],
    ['draft', { kind: 'draft' }],
    ['overdue', { kind: 'overdue' }],
    ['responded', { kind: 'responded' }],
    ['issued', { kind: 'open', dueAt: '2026-10-08T09:00:00Z' }],
  ] as const)('shows %s as %o', (status, cell) => {
    expect(clarificationCell(at(status))).toEqual(cell);
  });
});

describe('row actions', () => {
  const reviewer = { subject: ME.subject, supervisor: false };
  const supervisor = { subject: ME.subject, supervisor: true };

  it('offers Claim on a case nobody holds, to reviewers and supervisors', () => {
    expect(rowAction(caseItem(), reviewer)).toBe('claim');
    expect(rowAction(caseItem(), supervisor)).toBe('claim');
  });

  it('opens a case the viewer holds, or any held case for a supervisor', () => {
    const mine = caseItem({ assignee: ME, status: 'assigned' });
    const theirs = caseItem({ assignee: WAFULA, status: 'assigned' });
    expect(rowAction(mine, reviewer)).toBe('open');
    expect(rowAction(theirs, supervisor)).toBe('open');
    expect(rowAction(theirs, reviewer)).toBe('view');
  });

  it('gives a supervisor Reassign and Unassign on a held case, Assign on one nobody holds', () => {
    const theirs = caseItem({ assignee: WAFULA, status: 'assigned' });
    expect(rowMenu(theirs, supervisor)).toEqual(['reassign', 'unassign']);
    expect(rowMenu(caseItem(), supervisor)).toEqual(['assign']);
    expect(rowMenu(theirs, reviewer)).toEqual([]);
    expect(rowMenu(caseItem({ assignee: WAFULA, status: 'determined' }), supervisor)).toEqual([]);
  });

  it('leaves Release to the case view', () => {
    expect(rowMenu(caseItem({ assignee: ME, status: 'assigned' }), supervisor)).not.toContain(
      'release',
    );
  });
});
