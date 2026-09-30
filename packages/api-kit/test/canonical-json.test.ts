import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../src/canonical-json.js';

describe('canonicalJson (RFC 8785)', () => {
  it('sorts members at every level and drops whitespace', () => {
    expect(canonicalJson({ b: [3, { d: 1, c: 2 }], a: 'x' })).toBe(
      '{"a":"x","b":[3,{"c":2,"d":1}]}',
    );
  });

  it('sorts integer-like member names as strings, not numbers', () => {
    expect(canonicalJson({ b: 1, 10: 2, 2: 3 })).toBe('{"10":2,"2":3,"b":1}');
  });

  it('sorts by UTF-16 code units (RFC 8785 §3.2.3 example)', () => {
    const value = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      דּ: 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      ö: 'Latin Small Letter O With Diaeresis',
    };
    const values = [...canonicalJson(value).matchAll(/:"([^"]+)"/g)].map((match) => match[1]);
    expect(values).toEqual([
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ]);
    expect(canonicalJson(value).startsWith('{"\\r":"Carriage Return","1":"One"')).toBe(true);
  });

  it('serialises numbers as ECMAScript does (RFC 8785 §3.2.2.3)', () => {
    expect(canonicalJson([1e21, 1e-7, 0.000001, -0, 333333333.3333333, 4.5, 2 ** 53])).toBe(
      '[1e+21,1e-7,0.000001,0,333333333.3333333,4.5,9007199254740992]',
    );
  });

  it('leaves out undefined members, honours toJSON and refuses non-finite numbers', () => {
    expect(canonicalJson({ a: undefined, b: new Date('2027-11-01T00:00:00.000Z') })).toBe(
      '{"b":"2027-11-01T00:00:00.000Z"}',
    );
    expect(canonicalJson([undefined])).toBe('[null]');
    expect(canonicalJson(undefined)).toBe('null');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(RangeError);
  });

  it('is the same for equal values written in another order', () => {
    expect(canonicalJson({ x: { q: 1, p: [true, null] }, y: 'é' })).toBe(
      canonicalJson({ y: 'é', x: { p: [true, null], q: 1 } }),
    );
  });
});
