import { describe, expect, it } from 'vitest';

import {
  DCB,
  DCF,
  DCI,
  declarationSchemes,
  defineScheme,
  findScheme,
  numberingSchemes,
  OFR,
} from './schemes.js';

describe('numbering scheme registry', () => {
  it('registers OFR and the three declaration schemes', () => {
    expect(numberingSchemes.map((scheme) => scheme.code)).toEqual(['OFR', 'DCI', 'DCB', 'DCF']);
  });

  it('numbers each declaration type in its own scheme, with issuer and declaration year', () => {
    expect(declarationSchemes).toEqual({ initial: DCI, biennial: DCB, final: DCF });
    for (const scheme of [DCI, DCB, DCF]) {
      expect(scheme).toMatchObject({
        issuer: true,
        period: true,
        periodName: 'Declaration year',
        sequenceDigits: 7,
      });
    }
  });

  // Seeded from docs/glossary.md; the reference chip and documents explain numbers with these.
  it.each([
    { code: 'DCI', scheme: DCI, name: 'Initial declaration', legalBasis: 'Act s.34(1)' },
    { code: 'DCB', scheme: DCB, name: 'Biennial declaration', legalBasis: 'Act s.34(2)' },
    { code: 'DCF', scheme: DCF, name: 'Final declaration', legalBasis: 'Act s.34(3)' },
    { code: 'OFR', scheme: OFR, name: 'Officer reference', legalBasis: 'Adili Online' },
  ])('$code carries its name and legal basis', ({ scheme, name, legalBasis }) => {
    expect(scheme.name).toBe(name);
    expect(scheme.legalBasis).toBe(legalBasis);
    expect(scheme.description).not.toBe('');
  });

  it('finds a scheme by code', () => {
    expect(findScheme('DCB')).toBe(DCB);
    expect(findScheme('XYZ')).toBeUndefined();
    expect(findScheme('DCB', [OFR])).toBeUndefined();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(numberingSchemes)).toBe(true);
    expect(Object.isFrozen(DCB)).toBe(true);
    expect(Object.isFrozen(declarationSchemes)).toBe(true);
  });
});

describe('defineScheme', () => {
  const valid = {
    code: 'CLR',
    name: 'Clarification request',
    description: 'A request for missing information.',
    legalBasis: 'Act s.35',
    issuer: true,
    period: true,
    periodName: 'Year created',
    sequenceDigits: 7,
  };

  it('accepts a complete entry', () => {
    expect(defineScheme(valid)).toEqual(valid);
  });

  it('refuses an entry without its glossary text', () => {
    expect(() => defineScheme({ ...valid, name: ' ' })).toThrow(RangeError);
    expect(() => defineScheme({ ...valid, description: '' })).toThrow(RangeError);
    expect(() => defineScheme({ ...valid, legalBasis: '' })).toThrow(RangeError);
  });

  it('needs a periodName exactly when the scheme has a period', () => {
    expect(() => defineScheme({ ...valid, periodName: undefined })).toThrow(RangeError);
    expect(() => defineScheme({ ...valid, period: false })).toThrow(RangeError);
    expect(defineScheme({ ...valid, period: false, periodName: undefined })).toMatchObject({
      period: false,
    });
  });

  it('refuses a malformed code or width', () => {
    expect(() => defineScheme({ ...valid, code: 'CL' })).toThrow(RangeError);
    expect(() => defineScheme({ ...valid, sequenceDigits: 0 })).toThrow(RangeError);
  });
});
