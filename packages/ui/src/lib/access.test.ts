import { describe, expect, it } from 'vitest';

import {
  accessOutcomeLabels,
  accessOutcomeTones,
  accessStatusMeta,
  applicantAccessStatusMeta,
  DECIDED_ACCESS_STATUSES,
  GRANTED_ACCESS_STATUSES,
  leaStatusMeta,
  OPEN_ACCESS_STATUSES,
  grantPackageStatus,
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

  it('tints a decision the same for staff, applicants and law enforcement: partial is amber', () => {
    expect(accessOutcomeTones).toEqual({
      grant: 'success',
      'partial-grant': 'warning',
      deny: 'destructive',
    });
    for (const meta of [accessStatusMeta, applicantAccessStatusMeta]) {
      expect(meta.granted.tone).toBe('success');
      expect(meta['partially-granted'].tone).toBe('warning');
      expect(meta.denied.tone).toBe('destructive');
    }
    expect(leaStatusMeta.granted.tone).toBe('success');
    expect(leaStatusMeta.denied.tone).toBe('destructive');
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

describe('grantPackageStatus', () => {
  it('is preparing until the package or nil letter is issued', () => {
    expect(grantPackageStatus(null, null)).toBe('preparing');
  });

  it('says issuing failed once the backend records it', () => {
    expect(grantPackageStatus(null, '2026-10-02T09:00:00.000Z')).toBe('failed');
  });

  it('names what was issued: the access package, or the nil letter', () => {
    expect(grantPackageStatus({ kind: 'access-package' }, null)).toBe('access-package');
    expect(grantPackageStatus({ kind: 'nil-letter' }, null)).toBe('nil-letter');
  });
});
