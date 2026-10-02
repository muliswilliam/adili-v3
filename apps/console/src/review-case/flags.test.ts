import { describe, expect, it } from 'vitest';

import {
  MOCK_DECLARATION,
  MOCK_FLAG_IDS as F,
  MOCK_ITEM_IDS as I,
  mockFlags,
} from '../server/review/copilot-mock.server';
import type { Flag } from '../server/review/types';
import { readDeclaration } from './declaration';
import {
  concernsLine,
  evidenceLine,
  flagItemId,
  flagNoteError,
  groupFlags,
  openFlagsByItem,
  seedFromFlags,
  topSeverity,
} from './flags';

const flags = mockFlags('v2');
const view = readDeclaration(MOCK_DECLARATION);
const byId = (id: string) => {
  const found = flags.find((flag) => flag.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('groupFlags', () => {
  it('groups open flags by severity, high first, and keeps reviewed and closed ones apart', () => {
    const closed: Flag = {
      ...byId(F.foreign),
      id: 'closed',
      closedReason: 'superseded-by-recheck',
    };
    const groups = groupFlags([...flags, closed]);
    expect(groups.open.map((group) => [group.severity, group.flags.length])).toEqual([
      ['high', 1],
      ['medium', 2],
      ['info', 1],
    ]);
    expect(groups.reviewed.map((flag) => flag.id)).toEqual([F.late]);
    expect(groups.closed.map((flag) => flag.id)).toEqual(['closed']);
    expect(groups.openCount).toBe(4);
  });
});

describe('evidenceLine', () => {
  const line = (ruleId: Flag['ruleId'], evidence: Flag['evidence']) =>
    evidenceLine({ ruleId, evidence });

  it('says each rule’s facts in words, without amounts', () => {
    expect(line('value-change-25', { changePercent: 41, direction: 'up' })).toBe(
      'Value up 41% from the previous version',
    );
    expect(line('value-change-25', { changePercent: 30, direction: 'down' })).toBe(
      'Value down 30% from the previous version',
    );
    expect(line('value-change-25', { changePercent: null, direction: 'up' })).toBe(
      'Value up from nil in the previous version',
    );
    expect(line('change-flag-mismatch', { changePercent: 3, markedAsChanged: true })).toBe(
      'Marked as changed · value moved 3%',
    );
    expect(line('nil-after-populated', { category: 'liabilities', previousItems: 1 })).toBe(
      'Liabilities nil · 1 item in the previous version',
    );
    expect(line('income-vs-asset-growth', { growthToIncome: 2.4 })).toBe(
      'Asset growth 2.4 times the income declared for the period',
    );
    expect(
      line('late-filing', { dueDate: '2025-12-31', submittedOn: '2026-03-28', daysLate: 87 }),
    ).toBe('Submitted 87 days after the due date (31 Dec 2025)');
    expect(line('foreign-holdings', { items: 1, countries: ['GB'] })).toBe(
      '1 item outside Kenya (United Kingdom)',
    );
    expect(line('joint-share-inconsistent', { sharePercentTotal: 80, statements: 2 })).toBe(
      'Shares add up to 80% across 2 statements',
    );
    expect(line('no-previous-version', {})).toBe('No previous version');
  });

  it('says nothing for a rule it has no words for, or facts it cannot read', () => {
    expect(line('kra-pin-missing', {})).toBeNull();
    expect(line('late-filing', {})).toBeNull();
  });
});

describe('concernsLine', () => {
  it('names the item a flag points at, or the declaration as a whole', () => {
    expect(concernsLine(byId(F.valueChange), view, 'John Kennedy Otieno')).toBe(
      'Assets · Land · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno',
    );
    expect(concernsLine(byId(F.growth), view, 'John Kennedy Otieno')).toBe(
      'Declaration · John Kennedy Otieno',
    );
  });

  it('names the category and person for a flag about a statement', () => {
    const nil: Flag = {
      ...byId(F.growth),
      ruleId: 'nil-after-populated',
      evidence: { category: 'liabilities', previousItems: 1 },
      itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'statement:officer' }],
    };
    expect(concernsLine(nil, view, 'John Kennedy Otieno')).toBe(
      'Liabilities · John Kennedy Otieno',
    );
    // Without the document the declarant's name still says whose it is.
    expect(concernsLine(nil, null, 'John Otieno')).toBe('Liabilities · John Otieno');
  });
});

describe('flag pins and seeds', () => {
  it('counts the open flags on each item, and the most severe', () => {
    const pins = openFlagsByItem(flags);
    expect(pins.get(I.plot)?.map((flag) => flag.id)).toEqual([F.valueChange]);
    expect(pins.has(I.house)).toBe(false);
    expect(topSeverity([byId(F.foreign), byId(F.acquisition)])).toBe('medium');
    expect(flagItemId(byId(F.valueChange))).toBe(I.plot);
    expect(flagItemId(byId(F.growth))).toBeNull();
  });

  it('starts a clarification with one item per thing the picked flags point at', () => {
    const seed = seedFromFlags(flags, [F.valueChange, F.growth, F.valueChange, 'gone']);
    expect(seed).toEqual({
      label: null,
      opening: null,
      items: [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: I.plot,
          requirement: null,
          text: '',
        },
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: null,
          requirement: null,
          text: '',
        },
      ],
    });
  });

  it('needs a note of up to 1,000 characters to mark a flag reviewed', () => {
    expect(flagNoteError('  ')).toBe('Add a note to record what you concluded.');
    expect(flagNoteError('x'.repeat(1001))).toBe('Notes can be up to 1,000 characters.');
    expect(flagNoteError('Valuation report explains it.')).toBeNull();
  });
});
