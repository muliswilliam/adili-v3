import type { ItemSource } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import { type AcceptedFields, placementOf } from '../../src/suggestions/acceptance.js';

const SOURCE: ItemSource = {
  kind: 'ntsa',
  suggestionId: '0192f1a0-5a11-7000-8000-00000000c001',
  verificationResultId: '0192f1a0-5a11-7000-8000-00000000c002',
  at: '2026-10-02T08:00:00.000Z',
};
const NEW_ID = '0192f1a0-5a11-7000-8000-00000000c003';
const CAR_ID = '0192f1a0-5a11-7000-8000-00000000c004';
const SPOUSE_ID = '0192f1a0-5a11-7000-8000-00000000c005';

function asNew(fields: Record<string, unknown>): AcceptedFields {
  return { fields, applyToItemId: null, overwrite: false };
}

const officerStatement = { sectionKey: 'statement:officer' as const, personKey: 'officer' };

function statement(assets: unknown[] = [], extra: Record<string, unknown> = {}) {
  return { incomeNil: false, income: [], assetsNil: false, assets, ...extra };
}

const declaredCar = {
  id: CAR_ID,
  type: 'vehicle',
  description: 'Family car',
  details: { registration: 'kca-123a' },
  value: { kesCents: 150_000_000 },
  location: { inKenya: true },
  joint: { isJoint: false },
  change: { changed: false },
};

const fielder = {
  description: 'Toyota Fielder',
  registration: 'KCA 123A',
  make: 'Toyota',
  model: 'Fielder',
  year: 2016,
};

describe('accepting into a statement', () => {
  it('adds a vehicle with its source, its nil answer withdrawn, and no value', () => {
    const placement = placementOf(
      { ...officerStatement, itemType: 'vehicle', fields: fielder },
      asNew(fielder),
      SOURCE,
      NEW_ID,
    );

    const { contents, itemId } = placement.apply(statement([], { assetsNil: true }));

    expect(placement.sectionKey).toBe('statement:officer');
    expect(itemId).toBe(NEW_ID);
    expect(contents.assetsNil).toBe(false);
    expect(contents.assets).toEqual([
      {
        id: NEW_ID,
        type: 'vehicle',
        description: 'Toyota Fielder',
        details: { registration: 'KCA 123A', makeModel: 'Toyota Fielder, 2016' },
        location: { inKenya: true },
        joint: { isJoint: false },
        change: { changed: false },
        source: SOURCE,
      },
    ]);
  });

  it('describes land by its location when the registry county is not a county code', () => {
    const { contents } = placementOf(
      {
        ...officerStatement,
        itemType: 'land',
        fields: { parcelNumber: 'LR 209/1234', size: '1.25 ha', location: 'Coast Province' },
      },
      asNew({ parcelNumber: 'LR 209/1234', size: '1.25 ha', location: 'Coast Province' }),
      SOURCE,
      NEW_ID,
    ).apply(statement());

    expect(contents.assets).toEqual([
      expect.objectContaining({
        type: 'land',
        description: 'Land in Coast Province',
        details: { parcelNumber: 'LR 209/1234', size: '1.25 ha' },
        location: { inKenya: true, detail: 'Coast Province' },
      }),
    ]);
  });

  it('names a shareholding by the company number when the name is missing', () => {
    const { contents } = placementOf(
      {
        ...officerStatement,
        itemType: 'shareholding',
        fields: { registrationNumber: 'CPR/2009/12345', shares: 150 },
      },
      asNew({ registrationNumber: 'CPR/2009/12345', shares: 150 }),
      SOURCE,
      NEW_ID,
    ).apply(statement());

    expect(contents.assets).toEqual([
      expect.objectContaining({
        type: 'shareholding',
        description: 'Shares in CPR/2009/12345',
        details: { issuer: 'CPR/2009/12345', quantityOrPercent: '150 shares' },
      }),
    ]);
  });

  it('adds an income hint as a salary with no amount', () => {
    const { contents } = placementOf(
      { ...officerStatement, itemType: 'income-hint', fields: { incomeType: 'salary-emoluments' } },
      asNew({ incomeType: 'salary-emoluments' }),
      { ...SOURCE, kind: 'kra' },
      NEW_ID,
    ).apply(statement([], { incomeNil: true }));

    expect(contents.incomeNil).toBe(false);
    expect(contents.income).toEqual([
      {
        id: NEW_ID,
        type: 'salary-emoluments',
        location: { inKenya: true },
        change: { changed: false },
        source: { ...SOURCE, kind: 'kra' },
      },
    ]);
  });

  it('fills only the empty fields of the item it is applied to, and marks it', () => {
    const { contents, itemId } = placementOf(
      { ...officerStatement, itemType: 'vehicle', fields: fielder },
      { fields: fielder, applyToItemId: CAR_ID, overwrite: false },
      SOURCE,
      NEW_ID,
    ).apply(statement([declaredCar]));

    expect(itemId).toBe(CAR_ID);
    expect(contents.assets).toEqual([
      {
        ...declaredCar,
        details: { registration: 'kca-123a', makeModel: 'Toyota Fielder, 2016' },
        source: SOURCE,
      },
    ]);
  });

  it('overwrites when asked, but never the value, and keeps the source the item has', () => {
    const earlier = { ...SOURCE, suggestionId: '0192f1a0-5a11-7000-8000-00000000c009' };
    const { contents } = placementOf(
      { ...officerStatement, itemType: 'vehicle', fields: fielder },
      { fields: { ...fielder, value: 1 }, applyToItemId: CAR_ID, overwrite: true },
      SOURCE,
      NEW_ID,
    ).apply(statement([{ ...declaredCar, source: earlier }]));

    expect(contents.assets).toEqual([
      {
        ...declaredCar,
        description: 'Toyota Fielder',
        details: { registration: 'KCA 123A', makeModel: 'Toyota Fielder, 2016' },
        source: earlier,
      },
    ]);
  });

  it.each([
    ['an item not in the section', '0192f1a0-5a11-7000-8000-00000000c0ff'],
    ['an item of another type', CAR_ID],
  ])('refuses to apply a land suggestion to %s', (_, applyToItemId) => {
    const placement = placementOf(
      { ...officerStatement, itemType: 'land', fields: { parcelNumber: 'X/1' } },
      { fields: { parcelNumber: 'X/1' }, applyToItemId, overwrite: false },
      SOURCE,
      NEW_ID,
    );

    expect(() => placement.apply(statement([declaredCar]))).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) as unknown }),
    );
  });
});

describe('accepting outside the statements', () => {
  const other = {
    materialChanges: [],
    registrableInterests: {
      directorships: [{ company: 'Old Co Ltd', role: 'Director', remunerated: true }],
      memberships: [],
      dualCitizenship: { holds: false, pendingApplication: false },
      pendingCases: [],
    },
    freeText: '',
  };

  it("adds the officer's directorship to paragraph 9 with an id and its source", () => {
    const placement = placementOf(
      {
        itemType: 'directorship',
        sectionKey: 'other',
        personKey: 'officer',
        fields: { companyName: 'Kimumu Transporters Limited', role: 'Director' },
      },
      asNew({ companyName: 'Kimumu Transporters Limited', role: 'Director' }),
      { ...SOURCE, kind: 'brs' },
      NEW_ID,
    );

    const { contents, itemId } = placement.apply(other);

    expect(placement.sectionKey).toBe('other');
    expect(itemId).toBe(NEW_ID);
    expect(contents.registrableInterests).toEqual({
      ...other.registrableInterests,
      directorships: [
        ...other.registrableInterests.directorships,
        {
          id: NEW_ID,
          company: 'Kimumu Transporters Limited',
          role: 'Director',
          source: { ...SOURCE, kind: 'brs' },
        },
      ],
    });
  });

  it("puts a spouse's KRA PIN on the spouse, filling it only when empty", () => {
    const spouse: Record<string, unknown> = { id: SPOUSE_ID, name: { surname: 'Otieno' } };
    const household = {
      spouses: { none: false, items: [spouse] },
      children: { none: true, items: [] },
    };
    const accept = (stored: typeof household, overwrite = false) =>
      placementOf(
        {
          itemType: 'bio-tax',
          sectionKey: 'household',
          personKey: `spouse:${SPOUSE_ID}`,
          fields: { kraPin: 'A005231876K' },
        },
        { fields: { kraPin: 'a005231876k' }, applyToItemId: null, overwrite },
        { ...SOURCE, kind: 'kra' },
        NEW_ID,
      ).apply(stored);

    const filled = accept(household);
    expect(filled.itemId).toBe(SPOUSE_ID);
    expect(filled.contents.spouses).toEqual({
      none: false,
      items: [{ id: SPOUSE_ID, name: { surname: 'Otieno' }, kraPin: 'A005231876K' }],
    });
    const typed = {
      ...household,
      spouses: { none: false, items: [{ ...spouse, kraPin: 'P051234567Z' }] },
    };
    expect(accept(typed).contents.spouses).toEqual(typed.spouses);
    expect(
      (accept(typed, true).contents.spouses as { items: { kraPin: string }[] }).items[0]?.kraPin,
    ).toBe('A005231876K');
  });

  it.each([
    [
      "the declarant's own KRA PIN",
      { itemType: 'bio-tax', sectionKey: 'bio', personKey: 'officer', fields: {} },
    ],
    [
      'an unknown item type',
      { itemType: 'aircraft', sectionKey: 'statement:officer', personKey: 'officer', fields: {} },
    ],
  ] as const)('refuses %s (400)', (_, suggestion) => {
    expect(() => placementOf(suggestion, asNew({}), SOURCE, NEW_ID)).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) as unknown }),
    );
  });
});

describe("naming the registry's verification result on the item's source", () => {
  const vehicle = { ...officerStatement, itemType: 'vehicle', fields: fielder };
  const unverified = { kind: SOURCE.kind, suggestionId: SOURCE.suggestionId, at: SOURCE.at };
  const applied = { fields: fielder, applyToItemId: CAR_ID, overwrite: false };
  const car2017 = {
    ...declaredCar,
    details: { ...declaredCar.details, makeModel: 'Toyota Fielder, 2017' },
  };

  /** The source of the item the suggestion went into. */
  function sourceOf(accepted: AcceptedFields, assets: unknown[] = []): unknown {
    const { contents, itemId } = placementOf(vehicle, accepted, SOURCE, NEW_ID).apply(
      statement(assets),
    );
    return (contents.assets as { id: string; source?: unknown }[]).find(
      (item) => item.id === itemId,
    )?.source;
  }

  it('names it for the fields as they came, reworded only in the description', () => {
    expect(sourceOf(asNew(fielder))).toEqual(SOURCE);
    expect(sourceOf(asNew({ ...fielder, description: 'The school-run car' }))).toEqual(SOURCE);
    expect(sourceOf(asNew({ ...fielder, year: '2016', make: ' Toyota ' }))).toEqual(SOURCE);
  });

  it.each([
    ['a changed field', { ...fielder, year: 2017 }],
    ['a cleared field', { ...fielder, registration: '' }],
    ['a field left out', { ...fielder, model: undefined }],
  ])('leaves it off for %s', (_, fields) => {
    expect(sourceOf(asNew(fields))).toEqual(unverified);
  });

  it('ignores fields the suggestion never writes', () => {
    expect(sourceOf(asNew({ ...fielder, colour: 'Silver' }))).toEqual(SOURCE);
  });

  it('names it on an item applied to whose own values say what the registry said', () => {
    // "kca-123a" is the registry's KCA 123A, written another way.
    expect(sourceOf(applied, [declaredCar])).toEqual(SOURCE);
  });

  it('leaves it off an item applied to that keeps a value the registry did not give', () => {
    expect(sourceOf(applied, [car2017])).toEqual(unverified);
    // Overwritten with the registry's values, the item says what the registry said again.
    expect(sourceOf({ ...applied, overwrite: true }, [car2017])).toEqual(SOURCE);
  });
});
