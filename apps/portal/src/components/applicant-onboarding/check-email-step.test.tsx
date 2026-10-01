// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resendApplicantSetPasswordEmail } from '../../server/applicant-onboarding';
import type { ApplicantOnboardingSession } from '../../server/directory/types';
import { ApplicantCheckEmailStep } from './check-email-step';
import { PASSPORT_NOTICE } from './copy';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock('../../server/applicant-onboarding', () => ({
  resendApplicantSetPasswordEmail: vi.fn(),
}));
// The shared resend button lives with the declarant's outcome steps, which import these.
vi.mock('../../server/onboarding', () => ({
  leaveOnboarding: vi.fn(),
  resendSetPasswordEmail: vi.fn(),
}));

const resendMock = vi.mocked(resendApplicantSetPasswordEmail);

function confirmed(
  overrides: Partial<ApplicantOnboardingSession> = {},
): ApplicantOnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    state: 'confirmed',
    fullName: 'Mercy Wanjiru Kamau',
    identityDocument: { kind: 'national-id', number: '28841276', country: null },
    identityStatus: 'verified',
    contacts: {
      phone: { masked: '07** *** 903', verified: true },
      email: { masked: 'm***@example.com' },
    },
    otp: { channel: null, resendAvailableAt: null, resendsLeft: 0, attemptsLeft: 0 },
    outcome: 'account-created',
    setPasswordEmail: 'sent',
    expiresAt: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderStep(session: ApplicantOnboardingSession) {
  render(
    <ToastProvider>
      <ApplicantCheckEmailStep guard={{ status: 'active', session }} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  resendMock.mockReset();
});

describe('ApplicantCheckEmailStep', () => {
  it('says where the set-password link went and waits before a resend', () => {
    renderStep(confirmed());

    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByText('m***@example.com')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Resend email in/ }).disabled,
    ).toBe(true);
    expect(screen.queryByText(PASSPORT_NOTICE)).toBeNull();
  });

  it('repeats the pending verification notice for a passport holder', () => {
    renderStep(
      confirmed({
        identityDocument: { kind: 'passport', number: 'B1234567', country: 'UG' },
        identityStatus: 'pending-verification',
      }),
    );

    expect(screen.getByText(PASSPORT_NOTICE)).toBeTruthy();
  });

  it('offers to send an email that could not be sent', async () => {
    resendMock.mockResolvedValue({ ok: true, session: confirmed() });
    renderStep(confirmed({ setPasswordEmail: 'failed' }));

    expect(screen.getByRole('heading', { name: 'Your account is ready' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

    await waitFor(() => {
      expect(resendMock).toHaveBeenCalled();
    });
    expect(await screen.findByText('Email sent')).toBeTruthy();
  });

  it('explains how to get a new link without a session', () => {
    render(<ApplicantCheckEmailStep guard={{ status: 'none' }} />);

    expect(
      screen.getByRole('heading', { name: 'Get a new link to set your password' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Forgot password' }).getAttribute('href')).toBe(
      '/auth/recover',
    );
  });
});
