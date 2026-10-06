import { describe, expect, it } from 'vitest';

import { changeRows, compareStatements, statementChanges } from './comparison';
import type { AssetItem, Draft, IncomeItem, MaterialChangeEntry, Statement } from './contents';

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
      rows.map(({ kind, description, material, markedAsChanged }) => [
        kind,
        description,
        material,
        markedAsChanged,
      ]),
    ).toEqual([
      ['value', 'Salary', true, true],
      ['value', 'Plot in Nakuru', false, false],
      ['value', 'Plot in Eldoret', true, false],
      ['new', 'Plot in Voi', true, false],
      ['gone', 'Plot in Kitale', true, false],
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

describe('changeRows: whether an item is marked as the reviewer reads it', () => {
  const plot = (id: string, kesCents: number, change: Draft<AssetItem>['change']) => ({
    ...land(id, 'Plot in Voi', kesCents),
    change,
  });
  const marking = (previous: Draft<Statement>[], current: Draft<Statement>[]) =>
    statementChanges(previous, current, 'officer').rows.map((row) => [
      row.kind,
      row.markedAsChanged,
    ]);

  it("takes a new item as marked only when it is marked with its category's kind", () => {
    const current = (change: Draft<AssetItem>['change']) => [
      officer({ assets: [plot('v', 300_000, change)] }),
    ];

    expect(marking([], current({ changed: true, kind: 'acquisition' }))).toEqual([['new', true]]);
    expect(marking([], current({ changed: true, kind: 'value-change' }))).toEqual([['new', false]]);
    expect(marking([], current({ changed: true }))).toEqual([['new', false]]);
  });

  it('does not take a value change marked as an acquisition as marked', () => {
    const previous = [officer({ assets: [land('a', 'Plot in Voi', 100_000)] })];
    const current = (change: Draft<AssetItem>['change']) => [
      officer({ assets: [plot('a2', 300_000, change)] }),
    ];

    expect(marking(previous, current({ changed: true, kind: 'acquisition' }))).toEqual([
      ['value', false],
    ]);
    expect(marking(previous, current({ changed: true, kind: 'value-change' }))).toEqual([
      ['value', true],
    ]);
  });
});

describe('changeRows: whether paragraph 9 records a gone item, as the reviewer reads it', () => {
  const previous = [
    officer({
      income: [salary(1_000_000)],
      assets: [land('k', 'Plot in Kitale', 900_000)],
    }),
  ];
  const current = [officer({})];
  const recorded = (materialChanges?: MaterialChangeEntry[]) => {
    const [statement] = compareStatements(previous, current);
    if (!statement) throw new Error('no statement');
    return changeRows(statement, materialChanges).rows.map((row) => [
      row.description,
      row.recordedInParagraph9,
    ]);
  };
  const entry = (fields: Omit<MaterialChangeEntry, 'explanation'>): MaterialChangeEntry => ({
    explanation: 'Sold in 2026.',
    ...fields,
  });

  it('says nothing either way when paragraph 9 is not known', () => {
    expect(recorded()).toEqual([
      ['Salary', undefined],
      ['Plot in Kitale', undefined],
    ]);
  });

  it("takes an entry of the category's kind for the item's id as recording it", () => {
    expect(
      recorded([
        entry({ itemId: 'k', kind: 'disposal' }),
        entry({ itemId: 'salary', kind: 'source-ended' }),
      ]),
    ).toEqual([
      ['Salary', true],
      ['Plot in Kitale', true],
    ]);
  });

  it('takes an entry for the same person and description, however worded, as recording it', () => {
    expect(
      recorded([
        entry({ personKey: 'officer', itemDescription: 'plot in  KITALE.', kind: 'disposal' }),
      ]),
    ).toEqual([
      ['Salary', false],
      ['Plot in Kitale', true],
    ]);
  });

  it('does not take an entry of another kind, or for another person, as recording it', () => {
    expect(
      recorded([
        entry({ itemId: 'k', kind: 'settled' }),
        entry({ itemId: 'salary', kind: 'disposal' }),
        entry({ personKey: 'spouse:x', itemDescription: 'Plot in Kitale', kind: 'disposal' }),
        entry({ itemDescription: 'Plot in Kitale', kind: 'disposal' }),
      ]),
    ).toEqual([
      ['Salary', false],
      ['Plot in Kitale', false],
    ]);
  });

  it('is not set on a value change or a new item', () => {
    const [statement] = compareStatements(
      [officer({ income: [salary(1_000_000)] })],
      [officer({ income: [salary(2_000_000)], assets: [land('v', 'Plot in Voi', 300_000)] })],
    );
    if (!statement) throw new Error('no statement');

    expect(changeRows(statement, []).rows.map((row) => row.recordedInParagraph9)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('compareStatements: people and items in progress', () => {
  it('pairs a spouse declared again under a new id by their name', () => {
    const mary = { surname: 'Kennedy', firstName: 'Mary' };
    const previous: Draft<Statement>[] = [
      {
        personKey: 'spouse:old',
        personName: mary,
        assets: [land('a', 'Plot in Nyeri', 1_000_000)],
      },
    ];
    const current: Draft<Statement>[] = [
      {
        personKey: 'spouse:new',
        personName: { surname: ' kennedy', firstName: 'MARY ' },
        assets: [land('a2', 'Plot in Nyeri', 1_000_000)],
      },
    ];

    expect(compareStatements(previous, current).map((s) => s.personKey)).toEqual(['spouse:new']);
    expect(statementChanges(previous, current, 'spouse:new')).toEqual({ rows: [], unchanged: 1 });
  });

  it('does not pair people of different kinds, or a spouse already declared under the old id', () => {
    const name = { surname: 'Kamau', firstName: 'Amani' };
    const previous: Draft<Statement>[] = [
      { personKey: 'child:old', personName: name },
      { personKey: 'spouse:kept', personName: { surname: 'Kennedy', firstName: 'Mary' } },
    ];
    const current: Draft<Statement>[] = [
      { personKey: 'spouse:new', personName: name },
      { personKey: 'spouse:kept', personName: { surname: 'Kennedy', firstName: 'Mary' } },
    ];

    expect(compareStatements(previous, current).map((s) => s.personKey)).toEqual([
      'spouse:new',
      'spouse:kept',
      'child:old',
    ]);
  });

  it('shows nothing for an item whose value is still being typed, not its earlier one as gone', () => {
    const previous = [officer({ assets: [land('a', 'Plot in Kisumu', 1_000_000)] })];
    const current = [officer({ assets: [land('a2', 'Plot in Kisumu')] })];

    expect(statementChanges(previous, current, 'officer')).toEqual({ rows: [], unchanged: 0 });
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
