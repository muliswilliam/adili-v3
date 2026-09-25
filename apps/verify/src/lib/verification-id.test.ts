import { describe, expect, it } from 'vitest';

import { isVerificationId, normalizeVerificationId } from './verification-id';

describe('normalizeVerificationId', () => {
  it('uppercases and strips whitespace', () => {
    expect(normalizeVerificationId('  adl-7q4k-m2xr- 9htc ')).toBe('ADL-7Q4K-M2XR-9HTC');
  });

  it('maps look-alike letters after the prefix only', () => {
    expect(normalizeVerificationId('adl-o1lI-2345')).toBe('ADL-0111-2345');
  });
});

describe('isVerificationId', () => {
  it('accepts well-formed IDs', () => {
    expect(isVerificationId('ADL-7Q4K-M2XR-9HTC')).toBe(true);
  });

  it.each(['7Q4K-M2XR', 'ADL-7Q4K', 'ADL-7Q4K-M2XU', 'XYZ-7Q4K-M2XR', 'ADL--7Q4K'])(
    'rejects %s',
    (value) => {
      expect(isVerificationId(value)).toBe(false);
    },
  );
});
