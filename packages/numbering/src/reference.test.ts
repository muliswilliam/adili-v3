import { describe, expect, it } from 'vitest';

import { ALPHABET, hasValidCheckCharacter } from './check-character.js';
import { format, InvalidReferenceError, parse } from './reference.js';
import { defineScheme, OFR, RPT } from './schemes.js';

// Test-only scheme with issuer and period, to exercise the full ADR-011 shape.
const DCB = defineScheme({ code: 'DCB', issuer: true, period: true, sequenceDigits: 7 });
const schemes = [OFR, DCB];

describe('format', () => {
  it('formats an OFR as OFR-<7 digits>-<check>', () => {
    expect(format(OFR, { sequence: 482_913 })).toBe('OFR-0482913-L');
    expect(format(OFR, { sequence: 1 })).toBe('OFR-0000001-G');
  });

  it('formats issuer and period when the scheme has them', () => {
    expect(format(DCB, { issuer: 'TSC', period: 2027, sequence: 12_345 })).toBe(
      'DCB-TSC-2027-0012345-A',
    );
  });

  it('rejects parts the scheme does not take or is missing', () => {
    expect(() => format(OFR, { issuer: 'TSC', sequence: 1 })).toThrow(TypeError);
    expect(() => format(OFR, { period: 2027, sequence: 1 })).toThrow(TypeError);
    expect(() => format(DCB, { period: 2027, sequence: 1 })).toThrow(TypeError);
    expect(() => format(DCB, { issuer: 'TSC', sequence: 1 })).toThrow(TypeError);
  });

  it('rejects out-of-range sequences and malformed parts', () => {
    expect(() => format(OFR, { sequence: 0 })).toThrow(RangeError);
    expect(() => format(OFR, { sequence: 10_000_000 })).toThrow(RangeError);
    expect(() => format(OFR, { sequence: 1.5 })).toThrow(RangeError);
    expect(() => format(DCB, { issuer: 'tsc', period: 2027, sequence: 1 })).toThrow(RangeError);
    expect(() => format(DCB, { issuer: 'TSC', period: 27, sequence: 1 })).toThrow(RangeError);
  });
});

describe('parse', () => {
  it('round-trips format', () => {
    const cases = [
      { scheme: OFR, parts: { sequence: 482_913 } },
      { scheme: OFR, parts: { sequence: 9_999_999 } },
      { scheme: DCB, parts: { issuer: 'TSC', period: 2027, sequence: 12_345 } },
      { scheme: DCB, parts: { issuer: 'CPSB047', period: 2028, sequence: 87 } },
    ];
    for (const { scheme, parts } of cases) {
      const reference = format(scheme, parts);
      expect(parse(reference, schemes)).toEqual({
        scheme: scheme.code,
        issuer: parts.issuer,
        period: parts.period,
        sequence: parts.sequence,
        checkCharacter: reference.at(-1),
      });
    }
  });

  it('knows RPT by default, with issuer and financial year', () => {
    const reference = format(RPT, { issuer: 'PSC', period: 2027, sequence: 1 });
    expect(reference).toMatch(/^RPT-PSC-2027-0000001-[0-9A-Z]$/);
    expect(parse(reference)).toMatchObject({
      scheme: 'RPT',
      issuer: 'PSC',
      period: 2027,
      sequence: 1,
    });
  });

  it('knows OFR by default', () => {
    expect(parse('OFR-0482913-L')).toMatchObject({ scheme: 'OFR', sequence: 482_913 });
  });

  it.each([
    ['OFR-0482913-K', 'bad-check-character'],
    ['XYZ-0482913-L', 'unknown-scheme'],
    ['OFR-482913-L', 'malformed'],
    ['OFR-0482913', 'malformed'],
    ['OFR-TSC-0482913-L', 'malformed'],
    ['ofr-0482913-l', 'malformed'],
    ['OFR_0482913_L', 'malformed'],
    ['OFR-0000000-2', 'malformed'],
    ['', 'malformed'],
  ])('rejects %s with reason %s', (reference, reason) => {
    const attempt = () => parse(reference, schemes);
    expect(attempt).toThrow(InvalidReferenceError);
    expect(attempt).toThrow(expect.objectContaining({ reason, reference }));
  });
});

/**
 * S19: typos in a reference read out on the phone are caught by the check character.
 *
 * ISO 7064 hybrid MOD 37-36 detects every single-character substitution. It does not detect
 * every adjacent transposition: for each of the 36 running checksum states exactly one pair of
 * neighbouring values (differing by one, modulo 36) swaps undetected, 72 of 45,360 ordered
 * cases. The test proves every miss falls in that class and keeps the miss rate bounded, so a
 * change of algorithm or a bug cannot hide behind the known gap.
 */
// Millions of checks: well under a second alone, but CI runs it beside every other package.
describe(
  'S19: check character detects typos across 10,000 random OFRs',
  { timeout: 60_000 },
  () => {
    const random = seededRandom(19);
    const references = Array.from({ length: 10_000 }, () =>
      format(OFR, { sequence: 1 + Math.floor(random() * 9_999_999) }),
    );

    it('detects every single-character substitution', () => {
      let substitutions = 0;
      const missed: string[] = [];
      for (const reference of references) {
        for (let index = 0; index < reference.length; index++) {
          const original = reference.charAt(index);
          if (original === '-') continue;
          for (const replacement of ALPHABET) {
            if (replacement === original) continue;
            const typo = reference.slice(0, index) + replacement + reference.slice(index + 1);
            substitutions++;
            if (hasValidCheckCharacter(typo)) missed.push(typo);
          }
        }
      }
      expect(missed).toEqual([]);
      expect(substitutions).toBe(10_000 * 11 * 35);
    });

    it('detects every adjacent transposition outside the known undetectable class', () => {
      let transpositions = 0;
      let missed = 0;
      const unexplained: string[] = [];
      for (const reference of references) {
        const compact = reference.replaceAll('-', '');
        for (let index = 0; index < compact.length - 1; index++) {
          const [left, right] = [compact.charAt(index), compact.charAt(index + 1)];
          if (left === right) continue;
          const typo = compact.slice(0, index) + right + left + compact.slice(index + 2);
          transpositions++;
          if (!hasValidCheckCharacter(typo)) continue;
          missed++;
          if (!isKnownUndetectable(compact.slice(0, index), left, right)) unexplained.push(typo);
        }
      }
      expect(unexplained).toEqual([]);
      expect(transpositions).toBeGreaterThan(90_000);
      expect(missed / transpositions).toBeLessThan(0.01);
    });

    it('rejects a transposition across a separator as malformed', () => {
      expect(() => parse('OF-R0482913-L')).toThrow(InvalidReferenceError);
      expect(() => parse('OFR0-482913-L')).toThrow(InvalidReferenceError);
      expect(() => parse('OFR-048291-3L')).toThrow(InvalidReferenceError);
    });
  },
);

/** Independent restatement of the hybrid step (ISO 7064 §7): p = (2 * (s || 36)) mod 37. */
function isKnownUndetectable(prefix: string, left: string, right: string): boolean {
  const step = (state: number, char: string) =>
    ((((state || 36) * 2) % 37) + ALPHABET.indexOf(char)) % 36;
  let state = 18;
  for (const char of prefix) state = step(state, char);
  const distance = (ALPHABET.indexOf(left) - ALPHABET.indexOf(right) + 36) % 36;
  return (
    (distance === 1 || distance === 35) &&
    step(step(state, left), right) === step(step(state, right), left)
  );
}

/** Mulberry32: deterministic so a failure reproduces. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
