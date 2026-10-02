import { describe, expect, it } from 'vitest';

import {
  accessOutcomeLabels,
  accessStatusMeta,
  applicantAccessStatusMeta,
  DECIDED_ACCESS_STATUSES,
  GRANTED_ACCESS_STATUSES,
  leaStatusMeta,
  OPEN_ACCESS_STATUSES,
  PACKAGE_PREPARING_FOR_MS,
  unissuedPackageState,
} from './access';

describe('access status words', () => {
  it('names the step staff take next', () => {
    expect(accessStatusMeta['pending-applicant-verification'].label).toBe(
      'Verify applicant identity',
    );
    expect(accessStatusMeta['officer-unresolved'].label).toBe('Identify officer');
  });

  it('tells the applicant what is happening, in the shared words otherwise', () => {
    expect(applicantAccessStatusMeta['pending-applicant-verification'].label).toBe(
      'Awaiting identity verification',
    );
    expect(applicantAccessStatusMeta['awaiting-representations'].label).toBe('Declarant notified');
    expect(applicantAccessStatusMeta.granted).toEqual(accessStatusMeta.granted);
  });

  it('words law enforcement requests and outcomes once', () => {
    expect(Object.values(leaStatusMeta).map((meta) => meta.label)).toEqual([
      'Received',
      'Verified',
      'Granted',
      'Denied',
      'Withdrawn',
    ]);
    expect(accessOutcomeLabels).toEqual({
      grant: 'Granted',
      'partial-grant': 'Partially granted',
      deny: 'Denied',
    });
  });

  it('splits the statuses into open, decided and granted', () => {
    const all = Object.keys(accessStatusMeta);
    const open = all.filter((status) => OPEN_ACCESS_STATUSES.has(status as never));
    const decided = all.filter((status) => DECIDED_ACCESS_STATUSES.has(status as never));
    expect(open).toHaveLength(5);
    expect(decided).toEqual(['granted', 'partially-granted', 'denied']);
    expect(open.some((status) => decided.includes(status))).toBe(false);
    expect(
      [...GRANTED_ACCESS_STATUSES].every((status) => DECIDED_ACCESS_STATUSES.has(status)),
    ).toBe(true);
  });
});

describe('unissuedPackageState', () => {
  const decidedAt = '2026-10-02T09:00:00.000Z';
  const decided = Date.parse(decidedAt);

  it('reads as preparing for an hour after the grant', () => {
    expect(unissuedPackageState(decidedAt, decided)).toBe('preparing');
    expect(unissuedPackageState(decidedAt, decided + PACKAGE_PREPARING_FOR_MS - 1)).toBe(
      'preparing',
    );
  });

  it('then says no package was issued', () => {
    expect(unissuedPackageState(decidedAt, decided + PACKAGE_PREPARING_FOR_MS)).toBe('missing');
    expect(unissuedPackageState(decidedAt, decided + 5 * PACKAGE_PREPARING_FOR_MS)).toBe('missing');
  });
});
