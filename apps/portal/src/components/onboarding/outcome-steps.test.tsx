// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../../server/directory/types';
import { leaveOnboarding, resendSetPasswordEmail } from '../../server/onboarding';
import { CheckEmailStep } from './outcome-steps';

const navigate = vi.fn();
const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate }),
}));
vi.mock('../../server/onboarding', () => ({
  leaveOnboarding: vi.fn(),
  resendSetPasswordEmail: vi.fn(),
}));

const resendMock = vi.mocked(resendSetPasswordEmail);

function session(overrides: Partial<OnboardingSession> = {}): OnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    state: 'confirmed',
    commission: {
      slug: 'tsc',
      issuerCode: 'TSC',
      name: 'Teachers Service Commission',
      hasRoster: true,
    },
    contacts: {
      email: { masked: 'j***@tsc.go.ke', source: 'roster', verified: true },
      phone: { masked: '07** *** 123', source: 'roster', verified: true },
    },
    details: null,
    otp: { channel: null, resendAvailableAt: null, resendsLeft: 0, attemptsLeft: 0 },
    outcome: 'account-created',
    ofr: 'OFR-0000418-X',
    expiresAt: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}

const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

function renderCheckEmail(initial = session()) {
  render(
    <ToastProvider>
      <CheckEmailStep guard={{ status: 'active', session: initial }} />
    </ToastProvider>,
  );
}

function resendButton() {
  return screen.getByRole<HTMLButtonElement>('button', { name: /Resend email/ });
}

beforeEach(() => {
  navigate.mockReset();
  invalidate.mockReset();
  resendMock.mockReset();
  vi.mocked(leaveOnboarding).mockReset();
});

describe('CheckEmailStep', () => {
  it('holds the resend for 60 seconds from the first render when the directory gives no time', () => {
    renderCheckEmail(session());

    expect(resendButton().disabled).toBe(true);
    expect(resendButton().textContent).toBe('Resend email in 60s');
  });

  it('keeps to the wait the directory gives', () => {
    renderCheckEmail(session({ otp: { ...session().otp, resendAvailableAt: inSeconds(42) } }));

    expect(resendButton().textContent).toMatch(/Resend email in 4[12]s/);
  });

  it('sends the email again once the wait is over', async () => {
    renderCheckEmail(session({ otp: { ...session().otp, resendAvailableAt: inSeconds(-1) } }));
    resendMock.mockResolvedValue({
      ok: true,
      session: session({ otp: { ...session().otp, resendAvailableAt: inSeconds(60) } }),
    });

    expect(resendButton().disabled).toBe(false);
    fireEvent.click(resendButton());

    expect(await screen.findByText('Email sent again')).toBeDefined();
    await waitFor(() => {
      expect(resendButton().textContent).toMatch(/Resend email in (59|60)s/);
    });
  });
});
