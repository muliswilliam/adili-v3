// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../../server/directory/types';
import {
  leaveOnboarding,
  provideOnboardingContact,
  resendOnboardingCode,
  verifyOnboardingCode,
} from '../../server/onboarding';
import type { StepResult } from '../../server/onboarding.server';
import { GENERIC_ERROR } from './problems';
import { VerifyStep } from './verify-step';

const navigate = vi.fn();
const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate }),
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
  invalidate.mockReset();
  vi.mocked(provideOnboardingContact).mockReset();
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

  it.each([
    [
      'the directory is unavailable',
      () => verifyMock.mockResolvedValue({ ok: false, code: 'unavailable' }),
    ],
    ['the request fails', () => verifyMock.mockRejectedValue(new Error('network'))],
  ])('keeps the code for a retry when %s', async (_, arrange) => {
    arrange();
    renderStep();

    typeCode('123456');

    expect(await screen.findByText(GENERIC_ERROR)).toBeDefined();
    expect([1, 2, 3, 4, 5, 6].map((position) => box(position).value).join('')).toBe('123456');

    // Pasting it again sends it again.
    verifyMock.mockResolvedValue({ ok: true, session: { ...session(), state: 'email-verified' } });
    typeCode('123456');
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/get-started/verify-phone' });
    });
    expect(verifyMock).toHaveBeenCalledTimes(2);
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

  it('shows the Kenyan mobile hint when the declarant enters a phone', () => {
    render(
      <ToastProvider>
        <VerifyStep
          channel="phone"
          route="/get-started/verify-phone"
          guard={{
            status: 'active',
            session: { ...session(), state: 'phone-contact-required' },
          }}
        />
      </ToastProvider>,
    );

    const input = screen.getByRole('textbox', { name: 'Mobile number' });
    const hint = screen.getByText('Kenyan mobile, e.g. 0712 345 678');
    expect(input.getAttribute('aria-describedby')).toContain(hint.id);
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

  it('shows the session the loaders bring back after another tab moved it on', async () => {
    // The declarant enters an email here while another tab already did: the directory answers
    // 409 and the loaders rerun, bringing a session now waiting on the code sent to it.
    const contactRequired: OnboardingSession = {
      ...session(),
      state: 'email-contact-required',
      contacts: { email: null, phone: null },
    };
    const pending: OnboardingSession = {
      ...session(),
      contacts: {
        email: { masked: 'k***@devolution.go.ke', source: 'declarant', verified: false },
        phone: null,
      },
    };
    vi.mocked(provideOnboardingContact).mockResolvedValue({ ok: false, code: 'moved' });
    const step = (current: OnboardingSession) => (
      <ToastProvider>
        <VerifyStep
          channel="email"
          route="/get-started/verify-email"
          guard={{ status: 'active', session: current }}
        />
      </ToastProvider>
    );
    const { rerender } = render(step(contactRequired));
    invalidate.mockImplementation(() => {
      rerender(step(pending));
      return Promise.resolve();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'kamau@devolution.go.ke' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
      await Promise.resolve();
    });

    expect(invalidate).toHaveBeenCalled();
    expect(await screen.findByLabelText('Digit 1 of 6')).toBeDefined();
    expect(screen.queryByRole('textbox', { name: 'Email address' })).toBeNull();
    expect(screen.getByText('k***@devolution.go.ke')).toBeDefined();
  });
});
