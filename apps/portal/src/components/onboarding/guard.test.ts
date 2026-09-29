import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../../server/directory/types';
import { getOnboardingSession } from '../../server/onboarding';
import type { SessionLookup } from '../../server/onboarding.server';
import { requireCheckEmail, requireStep, redirectIfInProgress } from './guard';

vi.mock('../../server/onboarding', () => ({
  getOnboardingSession: vi.fn(),
}));

const lookupMock = vi.mocked(getOnboardingSession);

function session(
  state: OnboardingSession['state'],
  outcome: OnboardingSession['outcome'] = null,
): OnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    state,
    commission: {
      slug: 'tsc',
      issuerCode: 'TSC',
      name: 'Teachers Service Commission',
      hasRoster: true,
    },
    contacts: { email: null, phone: null },
    details: null,
    otp: { channel: null, resendAvailableAt: null, resendsLeft: 3, attemptsLeft: 5 },
    outcome,
    ofr: null,
    setPasswordEmail: null,
    expiresAt: '2099-01-01T00:00:00Z',
  };
}

function givenLookup(lookup: SessionLookup) {
  lookupMock.mockResolvedValue(lookup);
}

/** The redirect a guard threw, or a failure when it returned instead. */
async function redirectFrom(guard: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof guard === 'function' ? guard() : guard);
  } catch (thrown) {
    return (thrown as { options: unknown }).options;
  }
  throw new Error('expected a redirect');
}

beforeEach(() => {
  lookupMock.mockReset();
});

// S24
describe('requireStep', () => {
  it('lets a session on this step through', async () => {
    const active = { status: 'active', session: session('email-pending') } as const;
    givenLookup(active);

    expect(await requireStep('/get-started/verify-email')).toEqual(active);
  });

  it('sends a session on another step to that step', async () => {
    givenLookup({ status: 'active', session: session('phone-verified') });

    expect(await redirectFrom(requireStep('/get-started/verify-email'))).toMatchObject({
      to: '/get-started/confirm',
    });
  });

  it('sends a confirmed session to its outcome', async () => {
    givenLookup({ status: 'active', session: session('confirmed', 'linked-existing-account') });

    expect(await redirectFrom(requireStep('/get-started/check-email'))).toMatchObject({
      to: '/get-started/done',
    });
  });

  it.each([{ status: 'none' }, { status: 'ended' }] as const)(
    'starts again with a notice when the session is $status',
    async (lookup) => {
      givenLookup(lookup);

      expect(await redirectFrom(requireStep('/get-started/confirm'))).toMatchObject({
        to: '/get-started',
        search: { notice: 'ended' },
      });
    },
  );

  it('shows Done again for a linked session, e.g. on a refresh', async () => {
    const active = {
      status: 'active',
      session: session('confirmed', 'linked-existing-account'),
    } as const;
    givenLookup(active);

    expect(await requireStep('/get-started/done')).toEqual(active);
  });

  it('shows the step with a retry when the session cannot be read', async () => {
    givenLookup({ status: 'unavailable' });

    expect(await requireStep('/get-started/confirm')).toEqual({ status: 'unavailable' });
  });
});

describe('requireCheckEmail', () => {
  it('restores the page from the cookie', async () => {
    const active = { status: 'active', session: session('confirmed', 'account-created') } as const;
    givenLookup(active);

    expect(await requireCheckEmail()).toEqual(active);
  });

  it('explains how to get a new link when there is no session cookie', async () => {
    givenLookup({ status: 'none' });

    expect(await requireCheckEmail()).toEqual({ status: 'none' });
  });

  it('starts again with a notice when the session ended', async () => {
    givenLookup({ status: 'ended' });

    expect(await redirectFrom(requireCheckEmail())).toMatchObject({
      to: '/get-started',
      search: { notice: 'ended' },
    });
  });

  it('sends a session still in progress to its step', async () => {
    givenLookup({ status: 'active', session: session('email-pending') });

    expect(await redirectFrom(requireCheckEmail())).toMatchObject({
      to: '/get-started/verify-email',
    });
  });
});

describe('redirectIfInProgress', () => {
  it('sends a session in progress back to its step', async () => {
    expect(
      await redirectFrom(() => {
        redirectIfInProgress({ status: 'active', session: session('phone-pending') });
      }),
    ).toMatchObject({ to: '/get-started/verify-phone' });
  });

  it.each([
    { status: 'active', session: session('confirmed', 'linked-existing-account') },
    { status: 'active', session: session('confirmed', 'account-created') },
    { status: 'active', session: session('identity-mismatch', 'identity-mismatch') },
    { status: 'none' },
    { status: 'ended' },
    { status: 'unavailable' },
  ] as const)('starts fresh for a $status $session.state session', (lookup) => {
    expect(() => {
      redirectIfInProgress(lookup);
    }).not.toThrow();
  });
});
