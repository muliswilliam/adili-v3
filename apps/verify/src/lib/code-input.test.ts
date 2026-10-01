import { describe, expect, it } from 'vitest';

import { codeFromInput, formatCodeInput } from './code-input';

describe('formatCodeInput', () => {
  it('uppercases and groups what is typed in fours', () => {
    expect(formatCodeInput('7q4km2xr9h').value).toBe('7Q4K-M2XR-9H');
  });

  it('ignores spaces and hyphens wherever they are', () => {
    expect(formatCodeInput('7q4k m2xr--9htc ').value).toBe('7Q4K-M2XR-9HTC');
  });

  it('reads Crockford look-alikes as digits', () => {
    expect(formatCodeInput('oIlO').value).toBe('0110');
  });

  it('drops a pasted ADL prefix, in any case', () => {
    expect(formatCodeInput('ADL-7Q4K-M2XR').value).toBe('7Q4K-M2XR');
    expect(formatCodeInput('adl 7q4k').value).toBe('7Q4K');
  });

  it('stops at the 26 characters of a code', () => {
    const pasted = 'ADL-7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P-EXTRA';
    expect(formatCodeInput(pasted).value).toBe('7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P');
  });

  it('keeps the caret after the character it was after', () => {
    // Typing "X" after "7Q4K" in "7Q4K-M2XR": the raw value is "7Q4KX-M2XR", caret at 5.
    expect(formatCodeInput('7Q4KX-M2XR', 5)).toEqual({ value: '7Q4K-XM2X-R', caret: 6 });
    // At the start and at the end.
    expect(formatCodeInput('7q4k', 0)).toEqual({ value: '7Q4K', caret: 0 });
    expect(formatCodeInput('7q4km', 5)).toEqual({ value: '7Q4K-M', caret: 6 });
    // Deleting the hyphen's neighbour regroups but keeps the caret in place.
    expect(formatCodeInput('7Q4-M2XR', 3)).toEqual({ value: '7Q4M-2XR', caret: 3 });
  });

  it('counts the caret from after a pasted prefix', () => {
    expect(formatCodeInput('ADL-7Q4K', 8)).toEqual({ value: '7Q4K', caret: 4 });
    expect(formatCodeInput('ADL-7Q4K', 2)).toEqual({ value: '7Q4K', caret: 0 });
  });
});

describe('codeFromInput', () => {
  it('puts the prefix back', () => {
    expect(codeFromInput('7Q4K-M2XR')).toBe('ADL-7Q4K-M2XR');
  });
});
