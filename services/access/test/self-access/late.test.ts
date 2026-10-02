import { describe, expect, it } from 'vitest';

import { isLate } from '../../src/self-access/application-representation.js';
import type { CertifiedCopyRow } from '../../src/self-access/certified-copy-issuance.js';

const DEADLINE = new Date('2027-05-24T07:30:00.000Z');

const copy = (issuedAt: string | null) =>
  ({ issuedAt: issuedAt === null ? null : new Date(issuedAt) }) as CertifiedCopyRow;

describe('a written self-access application is late (14-day deadline)', () => {
  it('while its certified copy is not issued, once the deadline has passed', () => {
    expect(isLate(DEADLINE, copy(null), new Date('2027-05-24T07:30:00.000Z'))).toBe(false);
    expect(isLate(DEADLINE, copy(null), new Date('2027-05-24T07:30:00.001Z'))).toBe(true);
  });

  it('for good when its copy was issued after the deadline, never when issued in time', () => {
    const later = new Date('2027-07-01T00:00:00.000Z');
    expect(isLate(DEADLINE, copy('2027-05-25T09:00:00.000Z'), later)).toBe(true);
    expect(isLate(DEADLINE, copy('2027-05-20T09:00:00.000Z'), later)).toBe(false);
  });
});
