import { describe, expect, it } from 'vitest';

import {
  newVerificationId,
  normalizeVerificationId,
  VERIFICATION_ID_PATTERN,
} from '../src/contracts/index.js';

describe('verification ids', () => {
  it('prints 128 random bits as ADL- and seven Crockford base32 groups', () => {
    const id = newVerificationId();
    expect(id).toMatch(VERIFICATION_ID_PATTERN);
    expect(id).toHaveLength(36);
    expect(id).toMatch(/^ADL(-[0-9A-Z]{1,8})+$/);
  });

  it('encodes every bit: all zeros and all ones map to the ends of the alphabet', () => {
    expect(newVerificationId(new Uint8Array(16))).toBe('ADL-0000-0000-0000-0000-0000-0000-00');
    // 128 one bits and two zero padding bits: the last character carries 0b11100.
    expect(newVerificationId(new Uint8Array(16).fill(0xff))).toBe(
      'ADL-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZW',
    );
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newVerificationId()));
    expect(ids.size).toBe(1000);
  });

  it('normalises what a verifier types back to the printed form', () => {
    const id = newVerificationId();
    expect(normalizeVerificationId(id)).toBe(id);
    expect(normalizeVerificationId(id.toLowerCase())).toBe(id);
    expect(normalizeVerificationId(id.replaceAll('-', ' '))).toBe(id);
    expect(normalizeVerificationId(id.slice(4).replaceAll('-', ''))).toBe(id);
    expect(normalizeVerificationId('adl-o1lI-0000-0000-0000-0000-0000-00')).toBe(
      'ADL-0111-0000-0000-0000-0000-0000-00',
    );
    expect(normalizeVerificationId('ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9K')).toBeNull();
    expect(normalizeVerificationId('ADL-UUUU-0000-0000-0000-0000-0000-00')).toBeNull();
  });
});
