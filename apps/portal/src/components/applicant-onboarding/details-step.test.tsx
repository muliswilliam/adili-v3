// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startApplicantOnboarding } from '../../server/applicant-onboarding';
import { DETAILS_ERRORS } from './details';
import { DetailsStep } from './details-step';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../server/applicant-onboarding', () => ({ startApplicantOnboarding: vi.fn() }));

const startMock = vi.mocked(startApplicantOnboarding);

function field(name: string | RegExp) {
  return screen.getByRole<HTMLInputElement>('textbox', { name });
}

function fill(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    fireEvent.change(field(name), { target: { value } });
  }
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

const MERCY = {
  Surname: 'Kamau',
  'First name': 'Mercy',
  'National ID number': '2884 1276',
  'Mobile number': '0722 418 903',
  'Email address': 'mercy@example.com',
};

beforeEach(() => {
  navigate.mockReset();
  startMock.mockReset();
});

describe('DetailsStep', () => {
  it('shows every field to fix and focuses the first, without calling the directory', () => {
    render(<DetailsStep kind="national-id" />);
    fill({ 'First name': 'M', 'National ID number': '2884', 'Mobile number': '0722' });

    submit();

    expect(document.activeElement).toBe(field('Surname'));
    expect(screen.getByText(DETAILS_ERRORS.surname)).toBeTruthy();
    expect(screen.getByText(DETAILS_ERRORS.nationalId)).toBeTruthy();
    expect(screen.getByText(DETAILS_ERRORS.kenyanPhone)).toBeTruthy();
    expect(screen.getByText(DETAILS_ERRORS.email)).toBeTruthy();
    expect(startMock).not.toHaveBeenCalled();
  });

  it('starts with what was typed and moves on to the code', async () => {
    startMock.mockResolvedValue({ ok: true, route: '/access/get-started/verify-phone' });
    render(<DetailsStep kind="national-id" />);
    fill(MERCY);

    submit();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/access/get-started/verify-phone' });
    });
    expect(startMock).toHaveBeenCalledWith({
      data: {
        kind: 'national-id',
        surname: 'Kamau',
        firstName: 'Mercy',
        otherNames: '',
        number: '2884 1276',
        country: '',
        phone: '0722 418 903',
        email: 'mercy@example.com',
      },
    });
  });

  it('says the details do not match the national register (409 identity-mismatch)', async () => {
    startMock.mockResolvedValue({ ok: false, code: 'identity-mismatch' });
    render(<DetailsStep kind="national-id" />);
    fill(MERCY);

    submit();

    const alert = await screen.findByText(/do not match the national register/);
    expect(document.activeElement?.contains(alert)).toBe(true);
  });

  it('offers sign in and recover access to someone who already has an account', async () => {
    startMock.mockResolvedValue({
      ok: false,
      code: 'already-onboarded',
      links: { signIn: '/auth/login?x=1', recoverAccess: '/auth/recover' },
    });
    render(<DetailsStep kind="national-id" />);
    fill(MERCY);

    submit();

    expect(await screen.findByText('You already have an account.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/auth/login?x=1',
    );
    expect(screen.getByRole('link', { name: 'Recover access' })).toBeTruthy();
  });

  it('counts down on the button while rate-limited', async () => {
    startMock.mockResolvedValue({ ok: false, code: 'rate-limit-exceeded', retryAfterSeconds: 872 });
    render(<DetailsStep kind="national-id" />);
    fill(MERCY);

    submit();

    expect(await screen.findByText('Too many attempts. Try again in 15 minutes.')).toBeTruthy();
    const button = screen.getByRole<HTMLButtonElement>('button', { name: /Try again in 14:32/ });
    expect(button.disabled).toBe(true);
  });

  it.each([
    ['iprs-unavailable', /national register is not responding/],
    ['send-failed', /could not send the code/],
    ['unavailable', /Something went wrong/],
  ] as const)('shows %s', async (code, message) => {
    startMock.mockResolvedValue({ ok: false, code });
    render(<DetailsStep kind="national-id" />);
    fill(MERCY);

    submit();

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('shows the fields the directory refused as field errors', async () => {
    startMock.mockResolvedValue({ ok: false, code: 'invalid', fields: ['phone'] });
    render(<DetailsStep kind="national-id" />);
    fill(MERCY);

    submit();

    expect(await screen.findByText(DETAILS_ERRORS.kenyanPhone)).toBeTruthy();
    expect(document.activeElement).toBe(field('Mobile number'));
  });

  it('asks a passport holder for the passport number and issuing country', () => {
    render(<DetailsStep kind="passport" />);

    expect(field('Passport number')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Issuing country' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'National ID number' })).toBeNull();

    submit();
    expect(screen.getByText(DETAILS_ERRORS.country)).toBeTruthy();
    expect(screen.getByText(DETAILS_ERRORS.passport)).toBeTruthy();
  });
});
