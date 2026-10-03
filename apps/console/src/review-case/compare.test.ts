import { DiffTable } from '@adili/ui';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { VersionComparison } from '../server/review/types';
import { comparisonView } from './compare';

const SPOUSE = 'spouse:5b1c0000-0000-4000-8000-000000000001';
const PLOT = '1e2d3c4b-0000-4000-8000-000000000001';
const FUND = '1e2d3c4b-0000-4000-8000-000000000003';
const CAR = '1e2d3c4b-0000-4000-8000-000000000099';

const FUND_ITEM: VersionComparison['statements'][number]['onlyCurrent'][number] = {
  itemId: FUND,
  category: 'assets',
  type: 'securities',
  description: 'CIC Money Market Fund units',
  valueCents: 85_000_000,
  flaggedByDeclarant: false,
};

const comparison: VersionComparison = {
  previousVersion: 1,
  currentVersion: 2,
  statements: [
    {
      personKey: 'officer',
      personName: 'John Kennedy Otieno',
      matched: [
        {
          category: 'assets',
          type: 'land',
          description: 'Plot Kisumu/Manyatta/1234',
          previousCents: 180_000_000,
          currentCents: 450_000_000,
          deltaCents: 270_000_000,
          deltaPercent: 150,
          flaggedByDeclarant: false,
        },
        {
          category: 'income',
          type: 'salary-emoluments',
          description: 'Salary from the Teachers Service Commission',
          previousCents: 288_000_000,
          currentCents: 312_000_000,
          deltaCents: 24_000_000,
          deltaPercent: 8,
          flaggedByDeclarant: true,
        },
        {
          category: 'liabilities',
          type: 'mortgage',
          description: 'Mortgage from KCB Bank',
          previousCents: 390_000_000,
          currentCents: 340_000_000,
          deltaCents: -50_000_000,
          deltaPercent: -13,
          flaggedByDeclarant: false,
        },
        {
          category: 'assets',
          type: 'building',
          description: 'Three-bedroom house in Milimani',
          previousCents: 980_000_000,
          currentCents: 980_000_000,
          deltaCents: 0,
          deltaPercent: 0,
          flaggedByDeclarant: false,
        },
      ],
      onlyPrevious: [
        {
          itemId: CAR,
          category: 'assets',
          type: 'vehicle',
          description: 'Toyota Probox KCA 123X',
          valueCents: 60_000_000,
          flaggedByDeclarant: false,
        },
      ],
      onlyCurrent: [FUND_ITEM],
    },
    {
      personKey: SPOUSE,
      personName: 'Lilian Akoth Otieno',
      matched: [
        {
          category: 'assets',
          type: 'other',
          description: 'Shop stock',
          previousCents: 0,
          currentCents: 35_000_000,
          deltaCents: 35_000_000,
          deltaPercent: null,
          flaggedByDeclarant: true,
        },
      ],
      onlyPrevious: [],
      onlyCurrent: [],
    },
    {
      personKey: 'child:5b1c0000-0000-4000-8000-000000000002',
      personName: 'Brenda Otieno',
      matched: [],
      onlyPrevious: [],
      onlyCurrent: [],
    },
  ],
};

describe('comparisonView (S10, S19)', () => {
  const view = comparisonView(comparison);
  const officer = view.statements[0];

  it('keeps the versions and names each statement with its relation', () => {
    expect(view.previousVersion).toBe(1);
    expect(view.currentVersion).toBe(2);
    expect(view.previousIsEarlierVersion).toBe(true);
    // Version 1 against the last cycle's declaration, its own version 1.
    expect(
      comparisonView({ ...comparison, previousVersion: 1, currentVersion: 1 })
        .previousIsEarlierVersion,
    ).toBe(false);
    expect(view.statements.map((each) => [each.name, each.relationLabel])).toEqual([
      ['John Kennedy Otieno', 'Declarant'],
      ['Lilian Akoth Otieno', 'Spouse'],
      ['Brenda Otieno', 'Child'],
    ]);
  });

  it('groups rows by category in First Schedule order, matched first, then new, then gone', () => {
    expect(officer?.groups.map((group) => group.label)).toEqual([
      'Income',
      'Assets',
      'Liabilities',
    ]);
    const assets = officer?.groups[1]?.rows ?? [];
    expect(assets.map((row) => [row.label, row.previousCents, row.currentCents])).toEqual([
      ['Land', 180_000_000, 450_000_000],
      ['Building', 980_000_000, 980_000_000],
      ['Securities', null, 85_000_000],
      ['Vehicle', 60_000_000, null],
    ]);
    expect(assets[0]?.description).toBe('Plot Kisumu/Manyatta/1234');
  });

  it('says whether the declarant marked a change of 25% or more, or one they marked', () => {
    const [plot, house, fund, car] = officer?.groups[1]?.rows ?? [];
    expect(plot?.note).toBe('Not marked');
    // No change and not marked: nothing to say.
    expect(house?.note).toBeUndefined();
    expect(fund?.note).toBe('not marked');
    // A disposal is recorded in paragraph 9, which the comparison does not carry.
    expect(car?.note).toBeUndefined();
    expect(officer?.groups[0]?.rows[0]?.note).toBe('Marked as changed');
    expect(view.statements[1]?.groups[0]?.rows[0]?.note).toBe('Marked as changed');
    // A smaller change the declarant did not mark is left to the numbers.
    expect(officer?.groups[2]?.rows[0]?.note).toBeUndefined();
  });

  it('gives no percentage when the previous value was nothing, and lets the table work out the rest', () => {
    expect(view.statements[1]?.groups[0]?.rows[0]?.deltaPercent).toBeNull();
    expect(officer?.groups[1]?.rows[0]?.deltaPercent).toBeUndefined();
  });

  it('gives every row a distinct id, even an item in one version only on both sides', () => {
    const twice = comparisonView({
      ...comparison,
      statements: [
        {
          personKey: 'officer',
          personName: 'John Kennedy Otieno',
          matched: [],
          onlyPrevious: [{ ...FUND_ITEM, itemId: PLOT }],
          onlyCurrent: [{ ...FUND_ITEM, itemId: PLOT }],
        },
      ],
    });
    const ids = twice.statements[0]?.groups.flatMap((group) => group.rows.map((row) => row.id));
    expect(new Set(ids).size).toBe(2);
  });

  it('counts matched items, changes of 25% or more, and items in one version only', () => {
    expect(view.counts).toEqual({ matched: 5, changedBig: 1, oneVersionOnly: 2 });
  });

  it('marks a statement with nothing in either version as empty', () => {
    expect(view.statements[2]?.groups).toEqual([]);
    expect(view.statements[2]?.empty).toBe(true);
    expect(officer?.empty).toBe(false);
  });
});

describe('comparisonView at the 25% threshold', () => {
  const at = (previousCents: number, currentCents: number) =>
    comparisonView({
      previousVersion: 1,
      currentVersion: 2,
      statements: [
        {
          personKey: 'officer',
          personName: 'John Kennedy Otieno',
          matched: [
            {
              category: 'assets',
              type: 'land',
              description: 'Plot Kisumu/Manyatta/1234',
              previousCents,
              currentCents,
              deltaCents: currentCents - previousCents,
              // The service rounds 24.6% up to 25.
              deltaPercent: Math.round(((currentCents - previousCents) / previousCents) * 100),
              flaggedByDeclarant: false,
            },
          ],
          onlyPrevious: [],
          onlyCurrent: [],
        },
      ],
    });

  const shaded = (view: ReturnType<typeof comparisonView>) =>
    renderToStaticMarkup(
      createElement(DiffTable, {
        caption: 'Changes',
        previousVersion: 1,
        currentVersion: 2,
        groups: view.statements[0]?.groups ?? [],
      }),
    ).includes('data-big');

  it('neither counts, notes nor shades a 24.6% change', () => {
    const view = at(100_000_000, 124_600_000);
    expect(view.counts.changedBig).toBe(0);
    expect(view.statements[0]?.groups[0]?.rows[0]?.note).toBeUndefined();
    expect(shaded(view)).toBe(false);
  });

  it('counts, notes and shades a 25.0% change', () => {
    const view = at(100_000_000, 125_000_000);
    expect(view.counts.changedBig).toBe(1);
    expect(view.statements[0]?.groups[0]?.rows[0]?.note).toBe('Not marked');
    expect(shaded(view)).toBe(true);
  });
});
