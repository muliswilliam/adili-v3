import { describe, expect, it } from 'vitest';

import { compareDeclarations, MONEY_FIELD, NEW_KIND, valueChange, valueOf } from './compare.js';
import type { AssetItem } from './declaration.v1.gen.js';

const KENYA = { inKenya: true, county: '047' } as const;

function land(description: string, kesCents: number, parcelNumber?: string): AssetItem {
  return {
    id: crypto.randomUUID(),
    type: 'land',
    description,
    value: { kesCents },
    location: KENYA,
    joint: { isJoint: false },
    change: { changed: false },
    ...(parcelNumber && { details: { parcelNumber } }),
  };
}

type Compared = Parameters<typeof compareDeclarations>[0];
type ComparedStatement = Compared['statements'][number];

/** A declaration of the given statements, each with nothing but its assets. */
function declarationOf(
  statements: (Pick<ComparedStatement, 'personKey'> & { assets?: AssetItem[] })[],
): Compared {
  return {
    statements: statements.map(({ personKey, assets = [] }) => ({
      personKey,
      income: [],
      assets,
      liabilities: [],
    })),
  };
}

/** The comparison's statement for the person; fails the test when it has none. */
function statementOf(comparison: ReturnType<typeof compareDeclarations>, personKey: string) {
  const found = comparison.find((statement) => statement.personKey === personKey);
  if (!found) throw new Error(`no statement for ${personKey}`);
  return found;
}

describe('valueChange', () => {
  it.each([
    // previous, current, changePercent, material
    [100, 125, 25, true],
    [100, 75, -25, true],
    [100, 124, 24, false],
    [1000, 1249, 25, false], // 24.9% rounds to 25 but is under the threshold
    [100, 100, 0, false],
    [0, 0, null, false],
    [0, 500, null, true], // up from nothing is more than any percentage
  ])('%i to %i is %s%% and material: %s', (previous, current, changePercent, material) => {
    expect(valueChange(previous, current)).toEqual({
      previousCents: previous,
      currentCents: current,
      deltaCents: current - previous,
      changePercent,
      material,
    });
  });
});

describe('compareDeclarations', () => {
  it('pairs items statement by statement and marks value changes of 25% or more', () => {
    const previous = declarationOf([
      {
        personKey: 'officer',
        assets: [land('Plot in Kisumu', 1_000_000), land('Plot in Nakuru', 2_000_000)],
      },
    ]);
    const current = declarationOf([
      {
        personKey: 'officer',
        assets: [land('plot in KISUMU.', 1_500_000), land('Plot in Nakuru', 2_100_000)],
      },
    ]);

    const officer = statementOf(compareDeclarations(previous, current), 'officer');

    expect(officer.personKey).toBe('officer');
    expect(
      officer.matched.map(({ current: item, changePercent, material }) => [
        item.description,
        changePercent,
        material,
      ]),
    ).toEqual([
      ['plot in KISUMU.', 50, true],
      ['Plot in Nakuru', 5, false],
    ]);
    expect(officer.onlyPrevious).toEqual([]);
    expect(officer.onlyCurrent).toEqual([]);
  });

  it('pairs a parcel by its number whatever its description says', () => {
    const previous = declarationOf([
      { personKey: 'officer', assets: [land('Shamba', 1_000_000, 'KSM/1234')] },
    ]);
    const current = declarationOf([
      { personKey: 'officer', assets: [land('Plot at Kisumu', 1_000_000, 'ksm 1234')] },
    ]);

    const officer = statementOf(compareDeclarations(previous, current), 'officer');

    expect(officer.matched).toHaveLength(1);
  });

  it('lists what is new and what is gone, and statements only one declaration has', () => {
    const sold = land('Plot in Nakuru', 2_000_000);
    const bought = land('Plot in Kitale', 3_000_000);
    const spouse = 'spouse:0192f1a0-5a11-7000-8000-000000000101';
    const child = 'child:0192f1a0-5a11-7000-8000-000000000102';
    const previous = declarationOf([
      { personKey: 'officer', assets: [sold] },
      { personKey: child, assets: [land('Plot in Eldoret', 100)] },
    ]);
    const current = declarationOf([
      { personKey: 'officer', assets: [bought] },
      { personKey: spouse },
    ]);

    const comparison = compareDeclarations(previous, current);

    expect(comparison.map((statement) => statement.personKey)).toEqual(['officer', spouse, child]);
    const officer = statementOf(comparison, 'officer');
    const gone = statementOf(comparison, child);
    expect(officer.onlyCurrent.map((placed) => placed.item)).toEqual([bought]);
    expect(officer.onlyPrevious.map((placed) => placed.item)).toEqual([sold]);
    expect(gone.onlyPrevious).toHaveLength(1);
  });
});

describe('the categories', () => {
  it("keep an item's money in their own field, which is the value compared", () => {
    expect(MONEY_FIELD).toEqual({ income: 'amount', assets: 'value', liabilities: 'outstanding' });
    expect(valueOf(land('Plot in Kisumu', 700))).toBe(700);
  });

  it('each mark a new item with their own change kind', () => {
    expect(NEW_KIND).toEqual({
      income: 'new-source',
      assets: 'acquisition',
      liabilities: 'acquisition',
    });
  });
});
