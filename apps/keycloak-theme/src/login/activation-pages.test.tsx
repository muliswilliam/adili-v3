import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { actionTokenOf } from './action-token';
import KcPage from './KcPage';
import {
  EXPIRED_ACTIVATION_SEARCH,
  type PreviewName,
  previews,
  USED_ACTIVATION_SEARCH,
} from './previews';

/** Spec 01 stories 22, 23 and 25: the Keycloak pages of a reporting officer's activation. */
function renderPreview(name: PreviewName) {
  render(<KcPage kcContext={previews[name]()} />);
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('activation pages', () => {
  it('opens the emailed link on the steps in the order Keycloak runs them, with Continue', async () => {
    renderPreview('activation-landing');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Activate your account',
    );
    const steps = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(steps[0]).toContain('Confirm your email address');
    expect(steps[1]).toContain('Set up an authenticator app');
    expect(steps[2]).toContain('Choose a password');
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('#continue');
  });

  it('ends on "account ready" with the way into console sign-in', async () => {
    renderPreview('account-ready');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Your account is ready',
    );
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      'http://localhost:3020/auth/login',
    );
  });

  it('tells an officer with an expired activation link to ask EACC to resend', async () => {
    window.history.replaceState(null, '', `/${EXPIRED_ACTIVATION_SEARCH}`);

    renderPreview('link-expired');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'This link has expired',
    );
    expect(
      screen.getByText(
        'Activation links work for 72 hours. Ask EACC to send you a new invitation.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Already activated? Sign in' }).getAttribute('href'),
    ).toBe('http://localhost:3020/auth/login');
  });

  it('leads an officer whose activation link was already used to sign in', async () => {
    window.history.replaceState(null, '', `/${USED_ACTIVATION_SEARCH}`);

    renderPreview('link-expired');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'This link has been used',
    );
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      'http://localhost:3020/auth/login',
    );
  });

  it('keeps other expired links generic', async () => {
    renderPreview('link-expired');

    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Ask EACC/)).toBeNull();
    expect(screen.getByText(/work for a limited time/)).toBeTruthy();
  });

  it('shows other errors with Keycloak explanation under a plain title', async () => {
    renderPreview('error');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Something went wrong',
    );
    expect(screen.getByText('Invalid parameter: redirect_uri')).toBeTruthy();
  });

  it('enrols the authenticator with the QR code, a key fallback and the code field', async () => {
    renderPreview('configure-totp');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Set up your authenticator app',
    );
    expect(screen.getByRole('img', { name: 'Scan this QR code with the app' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cannot scan? Enter a key' })).toBeTruthy();
    expect(screen.getByLabelText('Enter the 6-digit code the app shows')).toBeTruthy();
    // Keycloak's "You need to set up Mobile Authenticator" warning repeats the title.
    expect(screen.queryByText(/You need to set up/)).toBeNull();
  });

  it('shows the key to type in when the officer cannot scan', async () => {
    renderPreview('configure-totp-manual');

    expect(await screen.findByText('KVVF G2BY N4YX S6LB IUYT K2LH IFYE 4SBV')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Scan a QR code instead' })).toBeTruthy();
  });

  it('sets the password with both fields and no repeated warning', async () => {
    renderPreview('update-password');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Choose a password',
    );
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm password')).toBeTruthy();
    expect(screen.queryByText(/You need to change your password/)).toBeNull();
  });

  it('asks for the authenticator code at sign-in', async () => {
    renderPreview('sign-in-code');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Enter your authenticator code',
    );
    expect(screen.getByLabelText('One-time code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('actionTokenOf', () => {
  it('reads the type, redirect and lifespan of a link', () => {
    expect(actionTokenOf(EXPIRED_ACTIVATION_SEARCH, Date.now())).toEqual({
      typ: 'execute-actions',
      reduri: 'http://localhost:3020/auth/login',
      lifespanHours: 72,
      expired: true,
    });
  });

  it.each(['', '?key=not-a-token', '?key=a.%%%.c', '?other=1'])('ignores %j', (search) => {
    expect(actionTokenOf(search, Date.now())).toBeNull();
  });
});
