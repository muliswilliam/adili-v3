// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../../server/directory/types';
import { confirmOnboarding } from '../../server/onboarding';
import type { StepResult } from '../../server/onboarding.server';
import { ConfirmStep } from './confirm-step';

const navigate = vi.fn();
const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate }),
}));
vi.mock('../../server/onboarding', () => ({
  confirmOnboarding: vi.fn(),
  leaveOnboarding: vi.fn(),
}));

const confirmMock = vi.mocked(confirmOnboarding);

function session(overrides: Partial<OnboardingSession> = {}): OnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    state: 'phone-verified',
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
    details: {
      fullName: 'Wanjiru Achieng Otieno',
      personnelFileNumber: 'TSC/100200',
      designation: 'Teacher',
      reportingEntity: null,
    },
    otp: { channel: null, resendAvailableAt: null, resendsLeft: 3, attemptsLeft: 5 },
    outcome: null,
    ofr: null,
    expiresAt: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderStep(initial = session()) {
  render(<ConfirmStep guard={{ status: 'active', session: initial }} />);
}

function confirmButton() {
  return screen.getByRole<HTMLButtonElement>('button', { name: /Confirm and create my account/ });
}

function tickAndConfirm() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm these are my details.' }));
  fireEvent.click(confirmButton());
}

/** The value next to a term in the details list. */
function valueOf(term: string) {
  const dt = screen.getByText(term, { selector: 'dt' });
  return dt.nextElementSibling?.textContent;
}

beforeEach(() => {
  navigate.mockReset();
  invalidate.mockReset();
  confirmMock.mockReset();
});

describe('ConfirmStep', () => {
  it("shows the roster's details, read-only", () => {
    renderStep();

    expect(screen.getByRole('heading', { level: 1, name: 'Confirm your details' })).toBeDefined();
    expect(valueOf('Full name')).toBe('Wanjiru Achieng Otieno');
    expect(valueOf('Personnel file number')).toBe('TSC/100200');
    expect(valueOf('Designation')).toBe('Teacher');
    expect(valueOf('Reporting entity')).toBe('Not on your record');
    expect(valueOf('Responsible Commission')).toBe('Teachers Service Commission');
    expect(valueOf('Email')).toContain('j***@tsc.go.ke');
    expect(valueOf('Phone')).toContain('07** *** 123');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('confirms only once the declarant ticks the box', () => {
    renderStep();

    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmButton());
    expect(confirmMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm these are my details.' }));
    expect(confirmButton().disabled).toBe(false);
  });

  it('says it is checking the national register while confirming', async () => {
    confirmMock.mockReturnValue(new Promise<StepResult>(() => undefined));
    renderStep();

    tickAndConfirm();

    expect(
      await screen.findByRole('button', { name: /Checking the national register/ }),
    ).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
  });

  it.each([
    ['account-created', '/get-started/check-email'],
    ['linked-existing-account', '/get-started/done'],
  ] as const)('moves on to the outcome for %s', async (outcome, route) => {
    confirmMock.mockResolvedValue({
      ok: true,
      session: session({ state: 'confirmed', outcome, ofr: 'OFR-0000418-X' }),
    });
    renderStep();

    tickAndConfirm();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: route });
    });
  });

  it('shows Not verified on an identity mismatch', async () => {
    confirmMock.mockResolvedValue({
      ok: true,
      session: session({ state: 'identity-mismatch', outcome: 'identity-mismatch' }),
    });
    renderStep();

    tickAndConfirm();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/get-started/not-verified' });
    });
  });

  it('asks the declarant to wait and retry when the register is not responding', async () => {
    confirmMock.mockResolvedValue({ ok: false, code: 'iprs-unavailable' });
    renderStep();

    tickAndConfirm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'The national register is not responding. Wait a few minutes and try again.',
    );
    expect(document.activeElement).toBe(alert);

    confirmMock.mockResolvedValue({
      ok: true,
      session: session({ state: 'confirmed', outcome: 'account-created' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/get-started/check-email' });
    });
  });

  it('says the account could not be created when the identity service fails', async () => {
    confirmMock.mockResolvedValue({ ok: false, code: 'identity-unavailable' });
    renderStep();

    tickAndConfirm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your account could not be created. Try again.');
    expect(document.activeElement).toBe(alert);
  });

  it('shows the generic error for anything else', async () => {
    confirmMock.mockResolvedValue({ ok: false, code: 'unavailable' });
    renderStep();

    tickAndConfirm();

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Something went wrong. Try again.',
    );
  });

  it('shows the generic error when the call itself fails', async () => {
    confirmMock.mockRejectedValue(new Error('network'));
    renderStep();

    tickAndConfirm();

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Something went wrong. Try again.',
    );
  });

  it('starts again, keeping the Commission, when the session has ended', async () => {
    confirmMock.mockResolvedValue({ ok: false, code: 'ended' });
    renderStep();

    tickAndConfirm();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/get-started',
        search: { commission: 'tsc', notice: 'ended' },
      });
    });
  });

  it('follows another tab that confirmed first', async () => {
    confirmMock.mockResolvedValue({ ok: false, code: 'moved' });
    renderStep();

    tickAndConfirm();

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it('offers a retry when the session could not be read', () => {
    render(<ConfirmStep guard={{ status: 'unavailable' }} />);

    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});
