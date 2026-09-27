// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../../server/directory/types';
import { leaveOnboarding, resendSetPasswordEmail } from '../../server/onboarding';
import { CheckEmailStep, DoneStep, NotVerifiedStep } from './outcome-steps';

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

  it('shows where the link went, the officer reference and a way to sign in', () => {
    renderCheckEmail();

    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeDefined();
    expect(screen.getByText('j***@tsc.go.ke')).toBeDefined();
    expect(screen.getByText(/expires in 24 hours/)).toBeDefined();
    expect(screen.getByText('OFR-0000418-X')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy officer reference' })).toBeDefined();
    expect(screen.getByText(/Quote it when you contact the helpdesk/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/auth/login');
  });

  it('says it is sending while the resend is in flight', async () => {
    renderCheckEmail(session({ otp: { ...session().otp, resendAvailableAt: inSeconds(-1) } }));
    resendMock.mockReturnValue(new Promise(() => undefined));

    fireEvent.click(resendButton());

    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDefined();
  });

  it('waits out a cooldown the directory reports', async () => {
    renderCheckEmail(session({ otp: { ...session().otp, resendAvailableAt: inSeconds(-1) } }));
    resendMock.mockResolvedValue({ ok: false, code: 'resend-cooldown', retryAfterSeconds: 30 });

    fireEvent.click(resendButton());

    await waitFor(() => {
      expect(resendButton().textContent).toMatch(/Resend email in (29|30)s/);
    });
  });

  it('starts again, keeping the Commission, when the session has ended', async () => {
    renderCheckEmail(session({ otp: { ...session().otp, resendAvailableAt: inSeconds(-1) } }));
    resendMock.mockResolvedValue({ ok: false, code: 'ended' });

    fireEvent.click(resendButton());

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/get-started',
        search: { commission: 'tsc', notice: 'ended' },
      });
    });
  });

  it('says so when the email could not be sent', async () => {
    renderCheckEmail(session({ otp: { ...session().otp, resendAvailableAt: inSeconds(-1) } }));
    resendMock.mockResolvedValue({ ok: false, code: 'unavailable' });

    fireEvent.click(resendButton());

    expect(await screen.findByText('We could not send the email')).toBeDefined();
  });

  it('lets the declarant leave and start again for another Commission', async () => {
    renderCheckEmail();

    fireEvent.click(screen.getByRole('button', { name: 'Start again for another Commission' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/get-started',
        search: { commission: undefined, notice: undefined },
      });
    });
    expect(leaveOnboarding).toHaveBeenCalled();
  });

  it('explains how to get a new link when there is no session', () => {
    render(<CheckEmailStep guard={{ status: 'none' }} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Get a new link to set your password' }),
    ).toBeDefined();
    expect(screen.getByText(/Use Forgot password on the sign-in page instead/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Forgot password' }).getAttribute('href')).toBe(
      '/auth/recover',
    );
    expect(screen.queryByText(/session ended/i)).toBeNull();
  });

  it('offers a retry when the session could not be read', () => {
    render(<CheckEmailStep guard={{ status: 'unavailable' }} />);

    expect(screen.getByText('Something went wrong. Try again.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});

describe('DoneStep', () => {
  const linked = session({ outcome: 'linked-existing-account', ofr: 'OFR-0000123-B' });

  it('says the Commission was added to the existing account', () => {
    render(<DoneStep guard={{ status: 'active', session: linked }} />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Teachers Service Commission added to your account',
      }),
    ).toBeDefined();
    expect(screen.getByText('OFR-0000123-B')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/auth/login');
  });

  it('forgets the finished session once shown, so Get started starts afresh', () => {
    render(<DoneStep guard={{ status: 'active', session: linked }} />);

    expect(leaveOnboarding).toHaveBeenCalledTimes(1);
  });

  it('offers to start again for another Commission', async () => {
    render(<DoneStep guard={{ status: 'active', session: linked }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start again for another Commission' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/get-started',
        search: { commission: undefined, notice: undefined },
      });
    });
  });

  it('offers a retry when the session could not be read', () => {
    render(<DoneStep guard={{ status: 'unavailable' }} />);

    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(leaveOnboarding).not.toHaveBeenCalled();
  });
});

describe('NotVerifiedStep', () => {
  const mismatch = session({ state: 'identity-mismatch', outcome: 'identity-mismatch', ofr: null });

  it('explains the register mismatch and who to contact', () => {
    render(<NotVerifiedStep guard={{ status: 'active', session: mismatch }} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'We could not verify your identity' }),
    ).toBeDefined();
    expect(
      screen.getByText(/Teachers Service Commission's roster does not match the national register/),
    ).toBeDefined();
  });

  it('starts again with the same Commission', async () => {
    render(<NotVerifiedStep guard={{ status: 'active', session: mismatch }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/get-started',
        search: { commission: 'tsc', notice: undefined },
      });
    });
    expect(leaveOnboarding).toHaveBeenCalled();
  });
});
