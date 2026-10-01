import { describe, expect, it } from 'vitest';

import { type SourceRef, refProblem, refsAmong } from './refs.js';

const SPOUSE = 'spouse:0192f1a0-5a11-7000-8000-000000000101';
const PLOT = '0192f1a0-5a11-7000-8000-000000002001';
const LOAN = '0192f1a0-5a11-7000-8000-000000003101';

const document = {
  statements: [
    { personKey: 'officer', income: [], assets: [{ id: PLOT, value: { kesCents: 100 } }] },
    { personKey: SPOUSE, liabilities: [{ id: LOAN }] },
  ],
};

const ref = (parts: Partial<SourceRef>): SourceRef => ({
  sectionKey: null,
  personKey: null,
  itemId: null,
  fieldPath: null,
  ...parts,
});

describe('refProblem against declaration documents', () => {
  it('accepts refs whose parts exist and agree', () => {
    expect(
      refProblem(ref({ sectionKey: 'statement:officer', personKey: 'officer', itemId: PLOT }), [
        document,
      ]),
    ).toBeNull();
    expect(refProblem(ref({ sectionKey: 'bio' }), [document])).toBeNull();
    expect(refProblem(ref({ fieldPath: '/statements/0/assets/0/value' }), [document])).toBeNull();
    expect(refProblem(ref({ itemId: LOAN }), [null, document])).toBeNull();
  });

  it('rejects parts that do not exist', () => {
    expect(refProblem(ref({ personKey: 'declarant' }), [document])).toMatch(/personKey/);
    expect(refProblem(ref({ itemId: '0192f1a0-5a11-7000-8000-00000000ffff' }), [document])).toMatch(
      /itemId/,
    );
    expect(refProblem(ref({ sectionKey: 'land' }), [document])).toMatch(/sectionKey/);
    expect(refProblem(ref({ fieldPath: '/statements/0/assets/7' }), [document])).toMatch(
      /fieldPath/,
    );
  });

  it('rejects real parts that do not belong together', () => {
    expect(refProblem(ref({ personKey: 'officer', itemId: LOAN }), [document])).toMatch(
      /does not belong/,
    );
    expect(
      refProblem(ref({ sectionKey: `statement:${SPOUSE}`, personKey: 'officer' }), [document]),
    ).toMatch(/does not belong/);
    expect(refProblem(ref({ sectionKey: 'statement:officer', itemId: LOAN }), [document])).toMatch(
      /does not belong/,
    );
  });
});

describe('refsAmong', () => {
  const plot = ref({ sectionKey: 'statement:officer', personKey: 'officer', itemId: PLOT });
  const allowed = [plot];

  it('accepts an input ref, with or without a field path the input left open', () => {
    expect(refsAmong(plot, allowed)).toBe(true);
    expect(refsAmong({ ...plot, fieldPath: null }, allowed)).toBe(true);
  });

  it('rejects any other ref', () => {
    expect(refsAmong({ ...plot, itemId: LOAN }, allowed)).toBe(false);
    expect(refsAmong({ ...plot, fieldPath: '/statements/0' }, allowed)).toBe(false);
  });
});
