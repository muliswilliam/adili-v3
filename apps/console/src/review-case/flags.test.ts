import { describe, expect, it } from 'vitest';

import { DOCUMENT, flag, ME, PLOT, SALARY } from './fixtures';
import { evidenceLine, flagTarget, flagTargetLine, groupFlags, pinsByItem } from './flags';

const reviewed = { at: '2026-10-02T07:47:00Z', by: ME, note: 'Explained by the bank statement.' };

describe('groupFlags', () => {
  it('groups open flags by severity, highest first, then the reviewed and the closed', () => {
    const groups = groupFlags([
      flag({ id: 'low', severity: 'low' }),
      flag({ id: 'high', severity: 'high' }),
      flag({ id: 'info', severity: 'info' }),
      flag({ id: 'done', severity: 'high', reviewed }),
      flag({ id: 'closed', severity: 'medium', closedReason: 'superseded-by-recheck' }),
      flag({
        id: 'closed-reviewed',
        severity: 'medium',
        closedReason: 'superseded-by-recheck',
        reviewed,
      }),
    ]);

    expect(groups.open.map(({ severity, flags }) => [severity, flags.map((f) => f.id)])).toEqual([
      ['high', ['high']],
      ['low', ['low']],
      ['info', ['info']],
    ]);
    expect(groups.reviewed.map((f) => f.id)).toEqual(['done', 'closed-reviewed']);
    expect(groups.closed.map((f) => f.id)).toEqual(['closed']);
    expect(groups.openCount).toBe(3);
  });
});

describe('evidenceLine', () => {
  it.each([
    ['value-change-25', { changePercent: 41, direction: 'up' }, 1, 'Value up 41% from version 1'],
    [
      'value-change-25',
      { changePercent: 42, direction: 'down' },
      null,
      'Value down 42% from the previous version',
    ],
    [
      'value-change-25',
      { changePercent: null, direction: 'up' },
      null,
      'Value up from nil in the previous version',
    ],
    [
      'change-flag-mismatch',
      { changePercent: 12, markedAsChanged: true },
      null,
      'Change of 12% · marked as changed',
    ],
    ['acquisition-unflagged', { category: 'assets' }, null, 'Assets · not in the previous version'],
    ['disposal-unflagged', { category: 'liabilities' }, 2, 'Liabilities · only in version 2'],
    [
      'nil-after-populated',
      { category: 'income', previousItems: 1 },
      null,
      'Income nil · 1 item in the previous version',
    ],
    [
      'income-vs-asset-growth',
      { growthToIncome: 4.8 },
      null,
      'Asset growth 4.8 times the income declared',
    ],
    [
      'late-filing',
      { daysLate: 22, dueDate: '2026-08-30', submittedOn: '2026-09-21' },
      null,
      'Submitted 22 days after the due date (30 Aug 2026)',
    ],
    ['foreign-holdings', { items: 2, countries: 'AE,US' }, null, '2 items'],
    [
      'joint-share-inconsistent',
      { sharePercentTotal: 80, statements: 2 },
      null,
      'Shares add up to 80% · 2 statements',
    ],
    ['completeness-residual', { issues: 3 }, null, '3 form checks not met'],
    [
      'registry-parcel-undeclared',
      { parcelNumber: 'KAJIADO/KITENGELA/48213' },
      null,
      'Parcel KAJIADO/KITENGELA/48213',
    ],
    [
      'directorship-employer-supplier',
      { companyRegistrationNumber: 'PVT-7XK2M9', role: 'director', declared: true },
      null,
      "Company PVT-7XK2M9 · role director · on the employer's supplier list",
    ],
    [
      'kra-income-mismatch',
      { differencePercent: 40, direction: 'below' },
      null,
      'Income declared to KRA lower by 40%',
    ],
  ] as const)('%s reads its facts', (ruleId, evidence, previous, line) => {
    expect(evidenceLine({ ruleId, evidence }, previous)).toBe(line);
  });

  it('names the countries of holdings outside Kenya', () => {
    expect(
      evidenceLine(
        { ruleId: 'foreign-holdings', evidence: { items: 2, countries: ['AE', 'US'] } },
        null,
      ),
    ).toBe('2 items · United Arab Emirates, United States');
  });

  it('gives no line for a rule without facts, or facts it cannot read', () => {
    expect(evidenceLine({ ruleId: 'no-previous-version', evidence: {} }, null)).toBeNull();
    expect(evidenceLine({ ruleId: 'registry-vehicle-undeclared', evidence: {} }, null)).toBeNull();
    expect(
      evidenceLine({ ruleId: 'late-filing', evidence: { daysLate: 'soon' } }, null),
    ).toBeNull();
  });
});

describe('what a flag points at', () => {
  it('names the item, or the statement, with the person', () => {
    expect(flagTargetLine(flag(), DOCUMENT)).toBe(
      'Income · Salary and emoluments · Wanjiku Njoki Kamau',
    );
    expect(
      flagTargetLine(
        flag({ itemRefs: [{ personKey: 'officer', itemId: 'gone', sectionKey: null }] }),
        DOCUMENT,
      ),
    ).toBe('Financial statement · Wanjiku Njoki Kamau');
    expect(flagTargetLine(flag(), null)).toBe('');
  });

  it('sends "Go to item" to the first item it names, else to its section', () => {
    expect(flagTarget(flag(), DOCUMENT)).toEqual({
      highlight: SALARY,
      itemId: SALARY,
      personKey: 'officer',
      sectionKey: null,
    });
    expect(
      flagTarget(
        flag({
          itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'statement:officer' }],
        }),
        DOCUMENT,
      ),
    ).toEqual({
      highlight: 'statement:officer',
      itemId: null,
      personKey: 'officer',
      sectionKey: 'statement:officer',
    });
    expect(flagTarget(flag({ itemRefs: [] }), DOCUMENT)).toBeNull();
    expect(flagTarget(flag(), null)).toBeNull();
  });
});

describe('pinsByItem', () => {
  it('counts the open flags on each item and opens the most severe', () => {
    const pins = pinsByItem([
      flag({ id: 'low', severity: 'low' }),
      flag({ id: 'high', severity: 'high' }),
      flag({ id: 'done', severity: 'high', reviewed }),
      flag({ id: 'plot', itemRefs: [{ personKey: 'officer', itemId: PLOT }] }),
    ]);

    expect(pins.get(SALARY)).toEqual({ count: 2, severity: 'high', flagId: 'high' });
    expect(pins.get(PLOT)).toEqual({ count: 1, severity: 'medium', flagId: 'plot' });
  });
});
