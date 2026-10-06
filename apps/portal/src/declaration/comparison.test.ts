import { describe, expect, it } from 'vitest';

import type { DeclarationListItem } from '../server/declarations/types';
import {
  changeRows,
  compareStatements,
  previousDeclarationOf,
  statementChanges,
} from './comparison';
import type { AssetItem, Draft, IncomeItem, Statement } from './contents';

function land(id: string, description: string, kesCents?: number): Draft<AssetItem> {
  return {
    id,
    type: 'land',
    description,
    ...(kesCents !== undefined && { value: { kesCents } }),
    change: { changed: false },
  };
}

const salary = (kesCents: number, changed = false): Draft<IncomeItem> => ({
  id: 'salary',
  type: 'salary-emoluments',
  description: 'Salary',
  amount: { kesCents },
  change: changed ? { changed, kind: 'value-change' } : { changed },
});

const officer = (items: Pick<Draft<Statement>, 'income' | 'assets'>): Draft<Statement> => ({
  personKey: 'officer',
  ...items,
});

describe('changeRows', () => {
  it('lists value changes, new and gone items, material ones marked, and counts the unchanged', () => {
    const previous = [
      officer({
        income: [salary(1_000_000)],
        assets: [
          land('a', 'Plot in Kisumu', 1_000_000),
          land('b', 'Plot in Nakuru', 2_000_000),
          land('c', 'Plot in Eldoret', 500_000),
          land('d', 'Plot in Kitale', 900_000),
        ],
      }),
    ];
    const current = [
      officer({
        income: [salary(1_300_000, true)],
        assets: [
          land('a2', 'Plot in Kisumu', 1_000_000),
          land('b2', 'Plot in Nakuru', 2_200_000),
          land('c2', 'Plot in Eldoret', 900_000),
          land('e2', 'Plot in Voi', 300_000),
        ],
      }),
    ];

    const [statement] = compareStatements(previous, current);
    if (!statement) throw new Error('no statement');
    const { rows, unchanged } = changeRows(statement);

    expect(unchanged).toBe(1);
    expect(
      rows.map(({ kind, description, changePercent, material, markedAsChanged }) => [
        kind,
        description,
        changePercent,
        material,
        markedAsChanged,
      ]),
    ).toEqual([
      ['value', 'Salary', 30, true, true],
      ['value', 'Plot in Nakuru', 10, false, false],
      ['value', 'Plot in Eldoret', 80, true, false],
      ['new', 'Plot in Voi', null, true, false],
      ['gone', 'Plot in Kitale', null, true, false],
    ]);
    expect(rows[2]).toMatchObject({
      category: 'assets',
      type: 'land',
      previousCents: 500_000,
      currentCents: 900_000,
      itemId: 'c2',
    });
    expect(rows[4]).toMatchObject({ previousCents: 900_000, currentCents: null, itemId: null });
  });

  it('leaves out an item still being filled in, which has no type or value yet', () => {
    const previous = [officer({ assets: [land('a', 'Plot in Kisumu', 1_000_000)] })];
    const current = [
      officer({
        assets: [land('a2', 'Plot in Kisumu', 1_000_000), land('b2', 'New plot'), { id: 'c2' }],
      }),
    ];

    const [statement] = compareStatements(previous, current);
    if (!statement) throw new Error('no statement');

    expect(changeRows(statement)).toEqual({ rows: [], unchanged: 1 });
  });
});

describe('statementChanges', () => {
  it("is one person's changes, or none when neither declaration has their statement", () => {
    const previous = [officer({ income: [salary(1_000_000)] })];
    const current = [officer({ income: [salary(2_000_000)] })];

    expect(statementChanges(previous, current, 'officer').rows).toHaveLength(1);
    expect(statementChanges(previous, current, 'spouse:x')).toEqual({ rows: [], unchanged: 0 });
  });
});

describe('previousDeclarationOf', () => {
  function listed(
    id: string,
    statementDate: string,
    currentVersion: number | null,
    submittedAt: string | null = currentVersion === null ? null : `${statementDate}T09:00:00Z`,
  ): DeclarationListItem {
    return { id, statementDate, currentVersion, submittedAt } as DeclarationListItem;
  }

  it('is the filed declaration with the latest statement date before this one', () => {
    const list = [
      listed('this', '2027-11-01', null),
      listed('older', '2023-11-01', 1),
      listed('previous', '2025-11-01', 2),
      listed('never-filed', '2026-06-01', null),
    ];

    expect(previousDeclarationOf(list, 'this')).toMatchObject({ id: 'previous' });
  });

  it('is none for the first declaration, or one not in the list', () => {
    expect(previousDeclarationOf([listed('this', '2027-11-01', null)], 'this')).toBeNull();
    expect(previousDeclarationOf([listed('older', '2025-11-01', 1)], 'this')).toBeNull();
  });

  it('is not the declaration itself while amending it', () => {
    const list = [listed('this', '2027-11-01', 1), listed('previous', '2025-11-01', 1)];

    expect(previousDeclarationOf(list, 'this')).toMatchObject({ id: 'previous' });
  });
});
