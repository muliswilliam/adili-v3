import type { Priority } from '@adili/ui';

import { type AssignmentAction, assignmentActions, type CaseViewer } from '../review-case/view';
import type { components } from '../server/review/api.gen';
import type { CaseListItem } from '../server/review/types';
import type { QueueTile } from './query';

/**
 * What a queue row and the summary tiles show (spec 07a FE-2), worked out from the case, the
 * counts and who is looking.
 */

export type QueueSummary = components['schemas']['QueueSummary'];

/** A tile's count and its split by priority, highest first. */
export interface TileCount {
  total: number;
  bands: { band: Priority; value: number }[];
}

const BANDS: readonly Priority[] = ['high', 'medium', 'low'];

export function tileCount(summary: QueueSummary, tile: QueueTile): TileCount {
  const counts = tile === 'mine' ? summary.mine : summary.byStatusAndBand[tile];
  const bands = BANDS.map((band) => ({ band, value: counts?.[band] ?? 0 }));
  return { total: bands.reduce((sum, each) => sum + each.value, 0), bands };
}

/** The Clarification column: the latest clarification issued, as the queue reads it. */
export type ClarificationCell =
  { kind: 'none' | 'draft' | 'overdue' | 'responded' } | { kind: 'open'; dueAt: string | null };

export function clarificationCell(item: Pick<CaseListItem, 'clarification'>): ClarificationCell {
  const { status, dueAt } = item.clarification;
  switch (status) {
    case null:
    case 'resolved':
    case 'withdrawn':
      return { kind: 'none' };
    case 'draft':
    case 'overdue':
    case 'responded':
      return { kind: status };
    case 'issued':
      return { kind: 'open', dueAt };
  }
}

/**
 * The row's button: Claim a case nobody holds, Open one the viewer holds (a supervisor opens any
 * to act on it), View one another reviewer holds.
 */
export type RowAction = 'claim' | 'open' | 'view';

export function rowAction(item: CaseListItem, viewer: CaseViewer): RowAction {
  if (assignmentActions(item, viewer).includes('claim')) return 'claim';
  if (item.assignee?.subject === viewer.subject || viewer.supervisor) return 'open';
  return 'view';
}

/** A supervisor's row menu: Reassign and Unassign a held case, Assign one nobody holds. */
export function rowMenu(item: CaseListItem, viewer: CaseViewer): AssignmentAction[] {
  return assignmentActions(item, viewer).filter(
    (action) => action === 'reassign' || action === 'unassign' || action === 'assign',
  );
}
