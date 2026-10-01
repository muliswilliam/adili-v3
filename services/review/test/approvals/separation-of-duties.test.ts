import type { Principal } from '@adili/api-kit';
import { describe, expect, it } from 'vitest';

import { cannotApprove } from '../../src/approvals/separation-of-duties.js';

const principal = (subject: string, role: string): Principal => ({
  subject,
  tenant: 'psc',
  roles: [role],
  scopes: [],
  clientId: 'console',
  name: null,
  issuedAt: null,
  personId: null,
  acr: null,
  authTime: null,
  tokenId: null,
});

describe('separation of duties', () => {
  const parties = { proposer: 'reviewer-a', reviewersOfRecord: new Set(['reviewer-a', 'sup-r']) };

  it.each([
    ['the proposer', principal('reviewer-a', 'reviewer'), 'proposer'],
    ['a supervisor who held the case', principal('sup-r', 'supervisor'), 'reviewer-of-record'],
    ['another reviewer', principal('reviewer-b', 'reviewer'), 'role'],
    ['another supervisor', principal('sup-s', 'supervisor'), null],
  ])('%s', (_, caller, reason) => {
    expect(cannotApprove(caller, parties)).toBe(reason);
  });

  it.each([
    ['a reviewer who held the case', principal('sup-r', 'reviewer'), 'reviewer-of-record'],
    ['another reviewer', principal('reviewer-b', 'reviewer'), null],
    ['another supervisor', principal('sup-s', 'supervisor'), null],
    ['a helpdesk agent', principal('helpdesk-h', 'helpdesk'), 'role'],
  ])('review staff may decide a notice or warning: %s', (_, caller, reason) => {
    expect(
      cannotApprove(caller, {
        proposer: null,
        reviewersOfRecord: new Set(['sup-r']),
        approverRole: 'review-staff',
      }),
    ).toBe(reason);
  });

  it('a system proposal has no proposer to exclude', () => {
    expect(
      cannotApprove(principal('sup-s', 'supervisor'), {
        proposer: null,
        reviewersOfRecord: new Set(),
      }),
    ).toBeNull();
  });
});
