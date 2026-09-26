import { describe, expect, it } from 'vitest';

import { checkCharacter, hasValidCheckCharacter } from './check-character.js';

describe('ISO 7064 MOD 37-36', () => {
  // Published identifiers that use the same hybrid system; values cross-checked against
  // python-stdnum's `stdnum.iso7064.mod_37_36`.
  it.each([
    ['A12425GABC1234002', 'M'], // GRid A1-2425G-ABC1234002-M
    ['00000000D07A0090', 'Q'], // ISAN 0000-0000-D07A-0090-Q (root check)
    ['00000000D07A009000000000', 'X'], // ISAN 0000-0000-D07A-0090-Q-0000-0000-X (version check)
    ['OFR0482913', 'L'],
    ['OFR0000001', 'G'],
    ['DCBTSC20270012345', 'A'],
    ['0', '2'],
    ['A', 'H'],
    ['Z', '4'],
  ])('check character of %s is %s', (input, expected) => {
    expect(checkCharacter(input)).toBe(expected);
    expect(hasValidCheckCharacter(input + expected)).toBe(true);
  });

  it('ignores hyphen separators', () => {
    expect(checkCharacter('A1-2425G-ABC1234002')).toBe('M');
    expect(hasValidCheckCharacter('A1-2425G-ABC1234002-M')).toBe(true);
  });

  it('rejects a wrong check character', () => {
    expect(hasValidCheckCharacter('A12425GABC1234002N')).toBe(false);
  });

  it('rejects characters outside 0-9 and A-Z', () => {
    expect(() => checkCharacter('ofr0482913')).toThrow(RangeError);
    expect(() => checkCharacter('OFR 0482913')).toThrow(RangeError);
    expect(() => checkCharacter('')).toThrow(RangeError);
    expect(hasValidCheckCharacter('ofr0482913L')).toBe(false);
    expect(hasValidCheckCharacter('')).toBe(false);
  });
});
