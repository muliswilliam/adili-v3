import { describe, expect, it } from 'vitest';

import type { DirectoryError, ProblemDetails } from '../../server/directory/client';
import { resendOutcome } from './resend';

const EMAIL = 'fatuma.wanjiru@tsc.go.ke';

const problem = (fields: Partial<ProblemDetails> & { status: number }): DirectoryError => ({
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Problem', ...fields },
});

describe('resendOutcome', () => {
  it('confirms a resend with the email it went to', () => {
    expect(resendOutcome(null, EMAIL)).toEqual({
      title: 'Invitation sent again to fatuma.wanjiru@tsc.go.ke',
      destructive: false,
      refetch: false,
    });
  });

  it('reports an activated officer (409) and refetches the card', () => {
    expect(
      resendOutcome(problem({ status: 409, type: 'reporting-officer-activated' }), EMAIL),
    ).toEqual({ title: 'This officer has already activated.', destructive: true, refetch: true });
  });

  it.each([
    [
      problem({ status: 404, type: 'reporting-officer-not-assigned' }),
      'This Commission no longer has a reporting officer.',
      true,
    ],
    [
      problem({ status: 409, type: 'reporting-officer-account-missing' }),
      "This officer's account no longer exists. Replace the officer to invite someone.",
      false,
    ],
    [problem({ status: 403 }), 'Only platform administrators can resend invitations.', false],
    [
      { kind: 'unavailable', detail: 'Identity provider unavailable' } as const,
      'The invitation was not sent again. Try again.',
      false,
    ],
    [problem({ status: 409 }), 'The invitation was not sent again. Try again.', false],
  ])('reports %j as a destructive toast', (error, title, refetch) => {
    expect(resendOutcome(error, EMAIL)).toEqual({ title, destructive: true, refetch });
  });
});
