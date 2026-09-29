import type { Principal } from '@adili/api-kit';
import { describe, expect, it } from 'vitest';

import { cannotApprove } from './separation-of-duties.js';

const principal = (subject: string, role: string): Principal => ({
  subject,
  tenant: 'psc',
  roles: [role],
  scopes: [],
  clientId: 'console',
  name: null,
  issuedAt: null,
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

  it('a system proposal has no proposer to exclude', () => {
    expect(
      cannotApprove(principal('sup-s', 'supervisor'), {
        proposer: null,
        reviewersOfRecord: new Set(),
      }),
    ).toBeNull();
  });
});
