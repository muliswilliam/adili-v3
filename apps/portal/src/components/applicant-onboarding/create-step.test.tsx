// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  completeApplicantOnboarding,
  leaveApplicantOnboarding,
} from '../../server/applicant-onboarding';
import type { ApplicantOnboardingSession } from '../../server/directory/types';
import { PASSPORT_NOTICE } from './copy';
import { CreateStep } from './create-step';

const navigate = vi.fn();
const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate }),
}));
vi.mock('../../server/applicant-onboarding', () => ({
  completeApplicantOnboarding: vi.fn(),
  leaveApplicantOnboarding: vi.fn(),
}));

const completeMock = vi.mocked(completeApplicantOnboarding);

function applicantSession(
  overrides: Partial<ApplicantOnboardingSession> = {},
): ApplicantOnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    state: 'phone-verified',
    fullName: 'Mercy Wanjiru Kamau',
    identityDocument: { kind: 'national-id', number: '28841276', country: null },
    identityStatus: 'verified',
    contacts: {
      phone: { masked: '07** *** 903', verified: true },
      email: { masked: 'm***@example.com' },
    },
    otp: { channel: null, resendAvailableAt: null, resendsLeft: 0, attemptsLeft: 0 },
    outcome: null,
    setPasswordEmail: null,
    expiresAt: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}

const PASSPORT = applicantSession({
  fullName: 'Amina Okello',
  identityDocument: { kind: 'passport', number: 'B1234567', country: 'UG' },
  identityStatus: 'pending-verification',
});

function create() {
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

beforeEach(() => {
  navigate.mockReset();
  completeMock.mockReset();
});

describe('CreateStep', () => {
  it('shows what the account is created with: the register match for a national ID', () => {
    render(<CreateStep guard={{ status: 'active', session: applicantSession() }} />);

    expect(screen.getByText('Mercy Wanjiru Kamau')).toBeTruthy();
    expect(screen.getByText('28841276')).toBeTruthy();
    expect(screen.getByText('Matches the register')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.queryByText(PASSPORT_NOTICE)).toBeNull();
  });

  it('tells a passport holder the Commission verifies them later (S1)', () => {
    render(<CreateStep guard={{ status: 'active', session: PASSPORT }} />);

    expect(screen.getByText('Passport')).toBeTruthy();
    expect(screen.getByText(/Uganda/)).toBeTruthy();
    expect(screen.queryByText('Matches the register')).toBeNull();
    expect(screen.getByText(PASSPORT_NOTICE)).toBeTruthy();
  });

  it('moves on to Check your email once the account exists', async () => {
    completeMock.mockResolvedValue({
      ok: true,
      session: applicantSession({ state: 'confirmed', outcome: 'account-created' }),
    });
    render(<CreateStep guard={{ status: 'active', session: applicantSession() }} />);

    create();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/access/get-started/check-email' });
    });
  });

  it('says the account could not be created (502 identity-unavailable)', async () => {
    completeMock.mockResolvedValue({ ok: false, code: 'identity-unavailable' });
    render(<CreateStep guard={{ status: 'active', session: applicantSession() }} />);

    create();

    expect(await screen.findByText('Your account could not be created. Try again.')).toBeTruthy();
  });

  it('lets the applicant change their details when the email is taken (409 email-in-use)', async () => {
    completeMock.mockResolvedValue({ ok: false, code: 'email-in-use' });
    render(<CreateStep guard={{ status: 'active', session: applicantSession() }} />);

    create();
    fireEvent.click(await screen.findByRole('button', { name: 'Change your details' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/access/get-started/details',
        search: { kind: 'national-id', notice: undefined },
      });
    });
    expect(vi.mocked(leaveApplicantOnboarding)).toHaveBeenCalled();
  });

  it('sends a sign-in to an applicant whose document got an account meanwhile', async () => {
    completeMock.mockResolvedValue({ ok: false, code: 'already-onboarded' });
    render(<CreateStep guard={{ status: 'active', session: applicantSession() }} />);

    create();

    expect(await screen.findByText('You already have an account.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('starts again when the session has ended', async () => {
    completeMock.mockResolvedValue({ ok: false, code: 'ended' });
    render(<CreateStep guard={{ status: 'active', session: applicantSession() }} />);

    create();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/access/get-started',
        search: { kind: 'national-id', notice: 'ended' },
      });
    });
  });
});
