// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  leaveApplicantOnboarding,
  verifyApplicantOnboardingCode,
} from '../../server/applicant-onboarding';
import type { ApplicantOnboardingSession } from '../../server/directory/types';
import { VerifyPhoneStep } from './verify-phone-step';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock('../../server/applicant-onboarding', () => ({
  leaveApplicantOnboarding: vi.fn(),
  resendApplicantOnboardingCode: vi.fn(),
  verifyApplicantOnboardingCode: vi.fn(),
}));

const verifyMock = vi.mocked(verifyApplicantOnboardingCode);

function pending(overrides: Partial<ApplicantOnboardingSession> = {}): ApplicantOnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    state: 'phone-pending',
    fullName: 'Amina Okello',
    identityDocument: { kind: 'passport', number: 'B1234567', country: 'UG' },
    identityStatus: 'pending-verification',
    contacts: { phone: { masked: '+256 ** *** 456', verified: false }, email: null },
    otp: { channel: 'phone', resendAvailableAt: null, resendsLeft: 3, attemptsLeft: 5 },
    outcome: null,
    setPasswordEmail: null,
    expiresAt: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderStep(session = pending()) {
  render(
    <ToastProvider>
      <VerifyPhoneStep guard={{ status: 'active', session }} />
    </ToastProvider>,
  );
}

function typeCode(code: string) {
  fireEvent.paste(screen.getByRole('textbox', { name: 'Digit 1 of 6' }), {
    clipboardData: { getData: () => code },
  });
}

beforeEach(() => {
  navigate.mockReset();
  verifyMock.mockReset();
});

describe('VerifyPhoneStep', () => {
  it('says where the code went and moves on to create once it is right', async () => {
    verifyMock.mockResolvedValue({ ok: true, session: pending({ state: 'phone-verified' }) });
    renderStep();

    expect(screen.getByText('+256 ** *** 456')).toBeTruthy();
    typeCode('123456');

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/access/get-started/create' });
    });
    expect(verifyMock).toHaveBeenCalledWith({ data: { code: '123456' } });
  });

  it('counts down wrong codes', async () => {
    verifyMock.mockResolvedValue({ ok: false, code: 'otp-invalid', attemptsLeft: 4 });
    renderStep();

    typeCode('111111');

    expect(await screen.findByText('That code is not right. 4 attempts left.')).toBeTruthy();
  });

  it('goes back to step 1 with "Too many attempts" after the last wrong code', async () => {
    verifyMock.mockResolvedValue({ ok: false, code: 'ended' });
    renderStep(
      pending({
        otp: { channel: 'phone', resendAvailableAt: null, resendsLeft: 3, attemptsLeft: 1 },
      }),
    );

    typeCode('111111');

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/access/get-started',
        search: { kind: 'passport', notice: 'too-many' },
      });
    });
  });

  it('lets the applicant change a wrong number on Your details', async () => {
    renderStep();

    fireEvent.click(screen.getByRole('button', { name: 'Change it' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/access/get-started/details',
        search: { kind: 'passport', notice: undefined },
      });
    });
    expect(vi.mocked(leaveApplicantOnboarding)).toHaveBeenCalled();
  });
});
