import { describe, expect, it } from 'vitest';

import type { Draft, Statement } from '../../../components/declaration/contents';
import type { RuleContext } from './context';
import { nilConflictsWithItems, statementCompleteness } from './statement';

function context(key = 'statement:officer'): RuleContext {
  return {
    key,
    statementDate: '2027-11-01',
    officer: {},
    household: {},
    statements: new Map(),
  };
}

const nil = { incomeNil: true, income: [], assetsNil: true, assets: [], liabilitiesNil: true };

const mortgage = {
  id: 'l1',
  type: 'mortgage' as const,
  description: 'Mortgage on the Kapsoya house',
  creditor: 'HFC Bank',
  outstanding: { kesCents: 2_400_000_00 },
  location: { inKenya: true },
  change: { changed: false },
};

describe('statementCompleteness (S7-S9)', () => {
  it('asks for every category that has neither items nor nothing to declare', () => {
    const issues = statementCompleteness({}, context());
    expect(issues.map((issue) => [issue.path, issue.code, issue.message])).toEqual([
      [
        '/income',
        'category-unanswered',
        'Your income: add at least one, or tick "Nothing to declare".',
      ],
      [
        '/assets',
        'category-unanswered',
        'Your assets: add at least one, or tick "Nothing to declare".',
      ],
      [
        '/liabilities',
        'category-unanswered',
        'Your liabilities: add at least one, or tick "Nothing to declare".',
      ],
    ]);
  });

  it('is complete when every category is nil (S8)', () => {
    expect(statementCompleteness({ ...nil, liabilities: [] }, context())).toEqual([]);
  });

  it('is complete with a filled liability', () => {
    expect(
      statementCompleteness({ ...nil, liabilitiesNil: false, liabilities: [mortgage] }, context()),
    ).toEqual([]);
  });

  it('reports a flagged change without an explanation at field level (S9)', () => {
    const statement: Draft<Statement> = {
      ...nil,
      personName: { firstName: 'Mary', surname: 'Kennedy' },
      liabilitiesNil: false,
      liabilities: [{ ...mortgage, change: { changed: true, kind: 'settled' } }],
    };
    expect(statementCompleteness(statement, context('statement:spouse:x'))).toEqual([
      {
        sectionKey: 'statement:spouse:x',
        path: '/liabilities/0/change/explanation',
        code: 'required',
        message: `Mary's liabilities, "Mortgage on the Kapsoya house": explain the change.`,
      },
    ]);
  });

  it('names an item without a description by its position', () => {
    const issues = statementCompleteness(
      { ...nil, assetsNil: false, assets: [{ id: 'a', location: { inKenya: true } }] },
      context(),
    );
    expect(issues.map((issue) => issue.message)).toEqual([
      'Your assets, item 1: choose a type.',
      'Your assets, item 1: enter a short description.',
      'Your assets, item 1: choose the county.',
      'Your assets, item 1: enter the approximate value.',
    ]);
    expect(issues.map((issue) => issue.path)).toEqual([
      '/assets/0/type',
      '/assets/0/description',
      '/assets/0/location/county',
      '/assets/0/value/kesCents',
    ]);
  });
});

describe('nilConflictsWithItems', () => {
  it('flags nothing to declare with items', () => {
    expect(nilConflictsWithItems({ assetsNil: true, assets: [{ id: 'a' }] })).toBe(true);
    expect(nilConflictsWithItems({ assetsNil: true, assets: [] })).toBe(false);
  });
});
