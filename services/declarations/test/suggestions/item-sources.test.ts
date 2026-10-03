import { describe, expect, it } from 'vitest';

import { keptSources, sectionItems } from '../../src/suggestions/item-sources.js';

const SOURCE = {
  kind: 'ntsa',
  suggestionId: '0192f1a0-5a11-7000-8000-00000000e001',
  verificationResultId: '0192f1a0-5a11-7000-8000-00000000e002',
  at: '2027-10-02T08:00:00.000Z',
};
const UNVERIFIED = { kind: SOURCE.kind, suggestionId: SOURCE.suggestionId, at: SOURCE.at };
const CAR_ID = '0192f1a0-5a11-7000-8000-00000000e003';
const DIRECTORSHIP_ID = '0192f1a0-5a11-7000-8000-00000000e004';

const car = {
  id: CAR_ID,
  type: 'vehicle',
  description: 'Toyota Fielder',
  details: { registration: 'KCA 123A', makeModel: 'Toyota Fielder, 2016' },
  source: SOURCE,
};

function statement(...assets: unknown[]) {
  return { incomeNil: true, income: [], assetsNil: false, assets, liabilities: [] };
}

function sourceAfter(saved: Record<string, unknown>): unknown {
  const body = keptSources('statement:officer', statement(car), statement(saved)) as {
    assets: { source?: unknown }[];
  };
  return body.assets[0]?.source;
}

describe("keeping an item's source through a section save", () => {
  it('keeps the stored source while the item holds what the registry said', () => {
    expect(sourceAfter(car)).toEqual(SOURCE);
    expect(
      sourceAfter({ ...car, description: 'The school-run car', value: { kesCents: 1 } }),
    ).toEqual(SOURCE);
    expect(sourceAfter({ ...car, details: { ...car.details, registration: 'kca-123a' } })).toEqual(
      SOURCE,
    );
  });

  it.each([
    ['the registration changes', { ...car, details: { ...car.details, registration: 'KCA 128A' } }],
    [
      'the make and model change',
      { ...car, details: { ...car.details, makeModel: 'Toyota Axio' } },
    ],
    ['the type changes', { ...car, type: 'other' }],
  ])('drops the verification result when %s', (_, saved) => {
    expect(sourceAfter(saved)).toEqual(UNVERIFIED);
  });

  it('takes no source from the body: the stored one, or none for an item that had none', () => {
    const forged = { ...SOURCE, verificationResultId: '0192f1a0-5a11-7000-8000-00000000e0ff' };
    expect(sourceAfter({ ...car, source: forged })).toEqual(SOURCE);
    expect(sourceAfter({ ...car, source: undefined })).toEqual(SOURCE);
    const typed = { id: '0192f1a0-5a11-7000-8000-00000000e005', type: 'vehicle', source: forged };
    const body = keptSources('statement:officer', statement(car), statement(car, typed)) as {
      assets: Record<string, unknown>[];
    };
    expect(body.assets[1]).not.toHaveProperty('source');
  });

  it('keeps a directorship source while the company and role stand', () => {
    const directorship = {
      id: DIRECTORSHIP_ID,
      company: 'Kimumu Transporters Limited',
      role: 'Director',
      source: { ...SOURCE, kind: 'brs' },
    };
    const other = (each: Record<string, unknown>) => ({
      registrableInterests: { directorships: [each] },
    });
    const after = (saved: Record<string, unknown>) =>
      sectionItems('other', keptSources('other', other(directorship), other(saved)) as never)[0]
        ?.source;

    expect(after({ ...directorship, company: 'KIMUMU TRANSPORTERS LTD' })).toEqual(
      directorship.source,
    );
    expect(after({ ...directorship, role: 'Secretary' })).toEqual({
      ...UNVERIFIED,
      kind: 'brs',
    });
  });

  it('leaves a body that is not an object to the save to refuse', () => {
    expect(keptSources('statement:officer', statement(car), 'nonsense')).toBe('nonsense');
  });
});
