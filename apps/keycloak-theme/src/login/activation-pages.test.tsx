import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { actionTokenOf } from './action-token';
import KcPage from './KcPage';
import {
  EXPIRED_DECLARANT_LINK_SEARCH,
  EXPIRED_STAFF_LINK_SEARCH,
  type StoryName,
  stories,
  USED_STAFF_LINK_SEARCH,
} from './stories';

/** Spec 01 stories 22, 23 and 25: the Keycloak pages of a reporting officer's activation. */
function renderStory(name: StoryName, search = '') {
  window.history.replaceState(null, '', `/${search}`);
  render(<KcPage kcContext={stories[name]()} />);
}

/** `search` with the token's redirect claim replaced, as a crafted link would have it. */
function withRedirect(search: string, reduri: string): string {
  const params = new URLSearchParams(search);
  const [header, payload, signature] = (params.get('key') ?? '').split('.');
  const claims = JSON.parse(atob(payload ?? '')) as Record<string, unknown>;
  const forged = btoa(JSON.stringify({ ...claims, reduri })).replace(/=+$/, '');
  params.set('key', `${header}.${forged}.${signature}`);
  return `?${params.toString()}`;
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('staff activation', () => {
  it('lists the steps of the emailed link in the order Keycloak runs them', async () => {
    renderStory('actions-landing-staff');

    expect(await heading('Activate your console account')).toBeTruthy();
    const steps = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(steps[0]).toContain('Confirm your email address');
    expect(steps[1]).toContain('Set up an authenticator app');
    expect(steps[2]).toContain('Choose a password');
  });

  it('enrols the authenticator with the QR code, a key fallback and the code field', async () => {
    renderStory('configure-totp');

    expect(await heading('Set up your authenticator app')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Scan this QR code with the app' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cannot scan? Enter a key' })).toBeTruthy();
    expect(screen.getByLabelText('Enter the 6-digit code the app shows')).toBeTruthy();
    // Keycloak's "You need to set up Mobile Authenticator" warning repeats the title.
    expect(screen.queryByText(/You need to set up/)).toBeNull();
  });

  it('shows the key to type in when the officer cannot scan', async () => {
    renderStory('configure-totp-manual');

    expect(await screen.findByText('KVVF G2BY N4YX S6LB IUYT K2LH IFYE 4SBV')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Scan a QR code instead' })).toBeTruthy();
  });

  it('does not repeat Keycloak’s password warning under the title', async () => {
    render(
      <KcPage
        kcContext={{
          ...stories['update-password-staff'](),
          message: {
            type: 'warning',
            summary: 'You need to change your password to activate your account.',
          },
        }}
      />,
    );

    expect(await heading('Set your password')).toBeTruthy();
    expect(screen.queryByText(/You need to change your password/)).toBeNull();
  });

  it('asks for the authenticator code at sign-in', async () => {
    renderStory('sign-in-code');

    expect(await heading('Enter your authenticator code')).toBeTruthy();
    expect(screen.getByLabelText('One-time code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('an emailed link Keycloak refuses, as it renders it (no client)', () => {
  it('tells an officer with an expired link to ask EACC, and leads to console sign-in', async () => {
    renderStory('link-expired-emailed', EXPIRED_STAFF_LINK_SEARCH);

    expect(await heading('This link has expired')).toBeTruthy();
    expect(screen.getByText(/Ask EACC to resend your invitation/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      'http://localhost:3020/auth/login',
    );
  });

  it('tells an officer whose link was already used to sign in', async () => {
    renderStory('link-expired-emailed', USED_STAFF_LINK_SEARCH);

    expect(await heading('This link does not work')).toBeTruthy();
    expect(screen.getByText(/Already activated\? Sign in/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe(
      'http://localhost:3020/auth/login',
    );
  });

  it.each([
    ['expired', EXPIRED_STAFF_LINK_SEARCH, 'Back to sign in'],
    ['used', USED_STAFF_LINK_SEARCH, 'Go to sign in'],
  ])('never leads from a %s link to the redirect it names', async (_state, search, link) => {
    renderStory('link-expired-emailed', withRedirect(search, 'https://phish.example/'));

    expect((await screen.findByRole('link', { name: link })).getAttribute('href')).toBe(
      'http://localhost:3020/auth/login',
    );
  });

  it('sends a declarant with an expired link to the portal for a new one', async () => {
    renderStory('link-expired-emailed', EXPIRED_DECLARANT_LINK_SEARCH);

    expect(await heading('This link has expired')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get a new link' }).getAttribute('href')).toBe(
      'http://localhost:3010/get-started/check-email',
    );
  });
});

describe('actionTokenOf', () => {
  it('reads the type and client of a link, and whether it expired', () => {
    expect(actionTokenOf(EXPIRED_STAFF_LINK_SEARCH, Date.now())).toEqual({
      typ: 'execute-actions',
      azp: 'console',
      expired: true,
    });
  });

  it.each(['', '?key=not-a-token', '?key=a.%%%.c', '?other=1'])('ignores %j', (search) => {
    expect(actionTokenOf(search, Date.now())).toBeNull();
  });
});
