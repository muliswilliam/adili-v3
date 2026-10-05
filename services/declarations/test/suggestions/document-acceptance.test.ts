import type { ItemSource } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import { readingPlacementOf } from '../../src/suggestions/document-acceptance.js';

const SOURCE: ItemSource = {
  kind: 'document',
  suggestionId: '0192f1a0-5a11-7000-8000-00000000d001',
  aiJobId: '0192f1a0-5a11-7000-8000-00000000d002',
  at: '2026-10-03T08:00:00.000Z',
};
const NEW_ID = '0192f1a0-5a11-7000-8000-00000000d003';
const CAR_ID = '0192f1a0-5a11-7000-8000-00000000d004';
const LOAN_ID = '0192f1a0-5a11-7000-8000-00000000d005';

/** A logbook as read: the fields, typed as declaration.v1 types them. */
const logbook = {
  sectionKey: 'statement:officer' as const,
  list: 'assets' as const,
  itemType: 'vehicle',
  fields: {
    'details.registration': 'KCB 782M',
    'details.makeModel': 'Toyota Premio',
    description: 'Toyota Premio saloon',
  },
};

const loanLetter = {
  sectionKey: 'statement:officer' as const,
  list: 'liabilities' as const,
  itemType: 'loan',
  fields: {
    creditor: 'Kenya Commercial Bank',
    'outstanding.kesCents': 125_000_000,
    description: 'Development loan',
  },
};

const declaredCar = {
  id: CAR_ID,
  type: 'vehicle',
  description: 'Family car',
  details: { registration: 'KCA 123A' },
  value: { kesCents: 150_000_000 },
  location: { inKenya: true },
  joint: { isJoint: false },
  change: { changed: false },
  attachments: [],
};

function statement(extra: Record<string, unknown> = {}) {
  return {
    incomeNil: true,
    income: [],
    assetsNil: false,
    assets: [],
    liabilitiesNil: true,
    liabilities: [],
    ...extra,
  };
}

describe('accepting a reading as a new item', () => {
  it("adds an item of the reading's type with the fields at their paths and the document as source", () => {
    const placement = readingPlacementOf(
      logbook,
      { fields: logbook.fields, applyToItemId: null, overwrite: false },
      SOURCE,
      NEW_ID,
    );

    const { contents, itemId } = placement.apply(statement());

    expect(placement.sectionKey).toBe('statement:officer');
    expect(itemId).toBe(NEW_ID);
    expect(contents.assets).toEqual([
      {
        id: NEW_ID,
        type: 'vehicle',
        description: 'Toyota Premio saloon',
        details: { registration: 'KCB 782M', makeModel: 'Toyota Premio' },
        location: { inKenya: true },
        joint: { isJoint: false },
        change: { changed: false },
        source: SOURCE,
      },
    ]);
  });

  it("takes the declarant's edits, typed as the reading typed the field, and withdraws a nil answer", () => {
    const { contents } = readingPlacementOf(
      loanLetter,
      {
        fields: { ...loanLetter.fields, 'outstanding.kesCents': '1,180,000', creditor: ' KCB ' },
        applyToItemId: null,
        overwrite: false,
      },
      SOURCE,
      NEW_ID,
    ).apply(statement());

    expect(contents.liabilitiesNil).toBe(false);
    expect(contents.liabilities).toEqual([
      {
        id: NEW_ID,
        type: 'loan',
        description: 'Development loan',
        creditor: 'KCB',
        outstanding: { kesCents: 1_180_000 },
        location: { inKenya: true },
        change: { changed: false },
        source: SOURCE,
      },
    ]);
  });

  it('leaves out a field the declarant emptied', () => {
    const { contents } = readingPlacementOf(
      logbook,
      {
        fields: { ...logbook.fields, 'details.makeModel': '  ' },
        applyToItemId: null,
        overwrite: false,
      },
      SOURCE,
      NEW_ID,
    ).apply(statement());

    expect((contents.assets as Record<string, unknown>[])[0]?.details).toEqual({
      registration: 'KCB 782M',
    });
  });

  it('refuses a field the reading did not give', () => {
    expect(() =>
      readingPlacementOf(
        logbook,
        {
          fields: { ...logbook.fields, 'value.kesCents': 100 },
          applyToItemId: null,
          overwrite: false,
        },
        SOURCE,
        NEW_ID,
      ),
    ).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) as unknown }),
    );
  });

  it('refuses an amount that is not a number', () => {
    expect(() =>
      readingPlacementOf(
        loanLetter,
        {
          fields: { ...loanLetter.fields, 'outstanding.kesCents': 'about a million' },
          applyToItemId: null,
          overwrite: false,
        },
        SOURCE,
        NEW_ID,
      ),
    ).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) as unknown }),
    );
  });
});

describe('applying a reading to the item the document is on', () => {
  it('fills only what the item leaves empty, keeps its value and attachments, and takes the source', () => {
    const { contents, itemId } = readingPlacementOf(
      logbook,
      { fields: logbook.fields, applyToItemId: CAR_ID, overwrite: false },
      SOURCE,
      NEW_ID,
    ).apply(statement({ assets: [declaredCar] }));

    expect(itemId).toBe(CAR_ID);
    expect(contents.assets).toEqual([
      {
        ...declaredCar,
        details: { registration: 'KCA 123A', makeModel: 'Toyota Premio' },
        source: SOURCE,
      },
    ]);
  });

  it('replaces what the item holds with overwrite', () => {
    const { contents } = readingPlacementOf(
      logbook,
      { fields: logbook.fields, applyToItemId: CAR_ID, overwrite: true },
      SOURCE,
      NEW_ID,
    ).apply(statement({ assets: [declaredCar] }));

    expect(contents.assets).toEqual([
      {
        ...declaredCar,
        description: 'Toyota Premio saloon',
        details: { registration: 'KCB 782M', makeModel: 'Toyota Premio' },
        source: SOURCE,
      },
    ]);
  });

  it("keeps an item's own source unless overwritten", () => {
    const sourced = { ...declaredCar, source: { ...SOURCE, kind: 'ntsa' } };
    const { contents } = readingPlacementOf(
      logbook,
      { fields: logbook.fields, applyToItemId: CAR_ID, overwrite: false },
      SOURCE,
      NEW_ID,
    ).apply(statement({ assets: [sourced] }));

    expect((contents.assets as Record<string, unknown>[])[0]?.source).toEqual(sourced.source);
  });

  it('refuses an item of another type or one no longer there', () => {
    const placement = readingPlacementOf(
      { ...loanLetter, itemType: 'mortgage' },
      { fields: loanLetter.fields, applyToItemId: LOAN_ID, overwrite: false },
      SOURCE,
      NEW_ID,
    );
    const loan = { id: LOAN_ID, type: 'loan', description: 'Loan', creditor: 'KCB' };

    expect(() => placement.apply(statement({ liabilities: [loan] }))).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) as unknown }),
    );
    expect(() => placement.apply(statement())).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) as unknown }),
    );
  });
});
