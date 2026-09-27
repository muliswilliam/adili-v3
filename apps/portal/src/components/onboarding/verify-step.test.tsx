// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../../server/directory/types';
import {
  leaveOnboarding,
  resendOnboardingCode,
  verifyOnboardingCode,
} from '../../server/onboarding';
import type { StepResult } from '../../server/onboarding.server';
import { VerifyStep } from './verify-step';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock('../../server/onboarding', () => ({
  leaveOnboarding: vi.fn(),
  provideOnboardingContact: vi.fn(),
  resendOnboardingCode: vi.fn(),
  verifyOnboardingCode: vi.fn(),
}));

const verifyMock = vi.mocked(verifyOnboardingCode);
const resendMock = vi.mocked(resendOnboardingCode);

function session(overrides: Partial<OnboardingSession['otp']> = {}): OnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    state: 'email-pending',
    commission: {
      slug: 'tsc',
      issuerCode: 'TSC',
      name: 'Teachers Service Commission',
      hasRoster: true,
    },
    contacts: {
      email: { masked: 'j***@tsc.go.ke', source: 'roster', verified: false },
      phone: { masked: '07** *** 123', source: 'roster', verified: false },
    },
    details: null,
    otp: {
      channel: 'email',
      resendAvailableAt: null,
      resendsLeft: 3,
      attemptsLeft: 5,
      ...overrides,
    },
    outcome: null,
    ofr: null,
    expiresAt: '2099-01-01T00:00:00Z',
  };
}

function renderStep(initial = session()) {
  render(
    <ToastProvider>
      <VerifyStep
        channel="email"
        route="/get-started/verify-email"
        guard={{ status: 'active', session: initial }}
      />
    </ToastProvider>,
  );
}

function box(position: number) {
  return screen.getByRole<HTMLInputElement>('textbox', {
    name: `Digit ${String(position)} of 6`,
  });
}

function typeCode(code: string) {
  fireEvent.paste(box(1), { clipboardData: { getData: () => code } });
}

/** A verify call that stays pending until `settle` is called. */
function pendingVerify() {
  let settle: (result: StepResult) => void = () => undefined;
  verifyMock.mockReturnValue(
    new Promise<StepResult>((resolve) => {
      settle = resolve;
    }),
  );
  return (result: StepResult) => {
    settle(result);
  };
}

beforeEach(() => {
  navigate.mockReset();
  verifyMock.mockReset();
  resendMock.mockReset();
  vi.mocked(leaveOnboarding).mockReset();
});

describe('VerifyStep', () => {
  it('sends the code on its sixth digit, with no button to press', async () => {
    const settle = pendingVerify();
    renderStep();

    expect(screen.queryByRole('button', { name: /Verify/ })).toBeNull();
    typeCode('123456');

    expect(verifyMock).toHaveBeenCalledWith({ data: { channel: 'email', code: '123456' } });
    expect(screen.getByText('Checking the code…')).toBeDefined();
    expect(box(1).disabled).toBe(true);

    settle({ ok: true, session: { ...session(), state: 'email-verified' } });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    expect(navigate).toHaveBeenCalledWith({ to: '/get-started/verify-phone' });
  });

  it('clears a wrong code and says how many attempts are left', async () => {
    verifyMock.mockResolvedValue({ ok: false, code: 'otp-invalid', attemptsLeft: 3 });
    renderStep();

    typeCode('999999');

    expect(await screen.findByText('That code is not right. 3 attempts left.')).toBeDefined();
    expect(box(1).value).toBe('');
    expect(box(1).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(box(1));
  });

  it('starts again with "too many attempts" when the last code was wrong', async () => {
    // A directory that ends the session on the last wrong code answers 410.
    verifyMock.mockResolvedValue({ ok: false, code: 'ended' });
    renderStep(session({ attemptsLeft: 1 }));

    typeCode('999999');

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/get-started',
        search: { commission: 'tsc', notice: 'too-many' },
      });
    });
  });

  it('counts resends once one is used, and starts again when none are left', async () => {
    renderStep(session({ resendsLeft: 0 }));

    expect(screen.getByText(/no more resends/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/get-started',
        search: { commission: 'tsc', notice: 'too-many' },
      });
    });
    expect(leaveOnboarding).toHaveBeenCalled();
    expect(resendMock).not.toHaveBeenCalled();
  });

  it('holds the resend link while the directory makes the declarant wait', () => {
    renderStep(session({ resendAvailableAt: new Date(Date.now() + 42_000).toISOString() }));

    const link = screen.getByRole<HTMLButtonElement>('button', { name: /Resend in \d+s/ });
    expect(link.disabled).toBe(true);
  });

  it('offers to start again for a contact the declarant typed', () => {
    const typed = session();
    typed.contacts.email = {
      masked: 'k***@devolution.go.ke',
      source: 'declarant',
      verified: false,
    };
    renderStep(typed);

    expect(screen.getByRole('button', { name: 'Start again' })).toBeDefined();
    expect(screen.queryByText(/Ask your reporting officer/)).toBeNull();
  });
});
