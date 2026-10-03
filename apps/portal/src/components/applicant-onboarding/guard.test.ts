import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isSignedInApplicant } from '../../server/access-requests';
import { getApplicantOnboardingSession } from '../../server/applicant-onboarding';
import type { ApplicantSessionLookup } from '../../server/applicant-onboarding.server';
import type { ApplicantOnboardingSession } from '../../server/directory/types';
import {
  redirectIfApplicantInProgress,
  redirectSignedInApplicant,
  requireApplicantCheckEmail,
  requireApplicantStep,
} from './guard';

vi.mock('../../server/applicant-onboarding', () => ({
  getApplicantOnboardingSession: vi.fn(),
}));

vi.mock('../../server/access-requests', () => ({ isSignedInApplicant: vi.fn() }));

const lookupMock = vi.mocked(getApplicantOnboardingSession);
const applicantMock = vi.mocked(isSignedInApplicant);

function session(state: ApplicantOnboardingSession['state']): ApplicantOnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    state,
    fullName: 'Mercy Kamau',
    identityDocument: { kind: 'national-id', number: '28841276', country: null },
    identityStatus: 'verified',
    contacts: { phone: null, email: null },
    otp: { channel: null, resendAvailableAt: null, resendsLeft: 3, attemptsLeft: 5 },
    outcome: null,
    setPasswordEmail: null,
    expiresAt: '2099-01-01T00:00:00Z',
  };
}

function givenLookup(lookup: ApplicantSessionLookup) {
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

describe('requireApplicantStep', () => {
  it('lets a session on this step through and sends one on another step there', async () => {
    const active = { status: 'active', session: session('phone-pending') } as const;
    givenLookup(active);
    expect(await requireApplicantStep('/access/get-started/verify-phone')).toEqual(active);

    givenLookup({ status: 'active', session: session('phone-verified') });
    expect(
      await redirectFrom(requireApplicantStep('/access/get-started/verify-phone')),
    ).toMatchObject({ to: '/access/get-started/create' });
  });

  it.each([{ status: 'none' }, { status: 'ended' }] as const)(
    'starts again with "Your session ended" when the session is $status',
    async (lookup) => {
      givenLookup(lookup);

      expect(await redirectFrom(requireApplicantStep('/access/get-started/create'))).toMatchObject({
        to: '/access/get-started',
        search: { notice: 'ended' },
      });
    },
  );

  it('hands an unreadable session to the page', async () => {
    givenLookup({ status: 'unavailable' });

    expect(await requireApplicantStep('/access/get-started/create')).toEqual({
      status: 'unavailable',
    });
  });
});

describe('requireApplicantCheckEmail', () => {
  it.each([{ status: 'none' }, { status: 'ended' }] as const)(
    'explains how to get a new link when the session is $status',
    async (lookup) => {
      givenLookup(lookup);

      expect(await requireApplicantCheckEmail()).toEqual({ status: 'none' });
    },
  );
});

describe('redirectIfApplicantInProgress', () => {
  it('resumes a session in progress and lets a finished one start again', async () => {
    expect(
      await redirectFrom(() => {
        redirectIfApplicantInProgress({ status: 'active', session: session('phone-verified') });
      }),
    ).toMatchObject({ to: '/access/get-started/create' });
    expect(() => {
      redirectIfApplicantInProgress({ status: 'active', session: session('confirmed') });
    }).not.toThrow();
  });
});

describe('redirectSignedInApplicant', () => {
  it('sends a signed-in applicant on to My requests', async () => {
    applicantMock.mockResolvedValue(true);
    expect(await redirectFrom(redirectSignedInApplicant())).toMatchObject({
      to: '/access/requests',
    });
  });

  it('leaves everyone else on the landing page', async () => {
    applicantMock.mockResolvedValue(false);
    await expect(redirectSignedInApplicant()).resolves.toBeUndefined();
  });
});
