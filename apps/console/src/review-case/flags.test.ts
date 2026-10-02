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
  openFlagsBySection,
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

  it('keeps a reviewed flag a re-check then closed with the reviewed, with its note', () => {
    const reviewedThenClosed: Flag = { ...byId(F.late), closedReason: 'superseded-by-recheck' };
    const groups = groupFlags([reviewedThenClosed]);
    expect(groups.reviewed.map((flag) => flag.id)).toEqual([F.late]);
    expect(groups.closed).toEqual([]);
  });
});

describe('evidenceLine', () => {
  const line = (ruleId: Flag['ruleId'], evidence: Flag['evidence']) =>
    evidenceLine({ ruleId, evidence });

  it.each([
    [
      'registry-parcel-undeclared',
      { parcelNumber: 'KAJIADO/KITENGELA/48213' },
      'Parcel KAJIADO/KITENGELA/48213',
    ],
    [
      'directorship-employer-supplier',
      { companyRegistrationNumber: 'PVT-7XK2M9', role: 'director', declared: true },
      "Company PVT-7XK2M9 · role director · on the employer's supplier list",
    ],
    [
      'registry-directorship-undeclared',
      { companyRegistrationNumber: 'PVT-9XYZ2L4Q', role: 'director_shareholder' },
      'Company PVT-9XYZ2L4Q · role director and shareholder',
    ],
    [
      'kra-income-mismatch',
      { differencePercent: 40, direction: 'below' },
      'Income declared to KRA lower by 40%',
    ],
    ['registry-supplier-check-not-run', { companies: 2 }, '2 companies listed at BRS'],
    [
      'registry-company-dissolved',
      { companyRegistrationNumber: 'PVT-9XYZ2L4Q' },
      'Company PVT-9XYZ2L4Q dissolved',
    ],
  ] as const)('%s reads its registry facts (spec 07b)', (ruleId, evidence, expected) => {
    expect(line(ruleId, evidence)).toBe(expected);
  });

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
    expect(line('registry-parcel-number-missing', {})).toBeNull();
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

describe('flag pins', () => {
  it('counts the open flags on each item, and the most severe', () => {
    const pins = openFlagsByItem(flags);
    expect(pins.get(I.plot)?.map((flag) => flag.id)).toEqual([F.valueChange]);
    expect(pins.has(I.house)).toBe(false);
    expect(topSeverity([byId(F.foreign), byId(F.acquisition)])).toBe('medium');
    expect(flagItemId(byId(F.valueChange))).toBe(I.plot);
    expect(flagItemId(byId(F.growth))).toBeNull();
  });

  it('Q10: counts the open flags on a section as a whole, by its section key', () => {
    const nil: Flag = {
      ...byId(F.growth),
      id: 'nil',
      itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'statement:officer' }],
    };
    const household: Flag = {
      ...byId(F.growth),
      id: 'household',
      itemRefs: [{ personKey: 'spouse-1', itemId: null, sectionKey: 'household' }],
    };
    const reviewed: Flag = { ...household, id: 'reviewed', reviewed: byId(F.late).reviewed };
    const pins = openFlagsBySection([nil, household, reviewed, byId(F.valueChange)]);
    expect(pins.get('statement:officer')?.map((flag) => flag.id)).toEqual(['nil']);
    expect(pins.get('household')?.map((flag) => flag.id)).toEqual(['household']);
    expect(pins.size).toBe(2);
  });

  it('needs a note of up to 1,000 characters to mark a flag reviewed', () => {
    expect(flagNoteError('  ')).toBe('Add a note to record what you concluded.');
    expect(flagNoteError('x'.repeat(1001))).toBe('Notes can be up to 1,000 characters.');
    expect(flagNoteError('Valuation report explains it.')).toBeNull();
  });
});
