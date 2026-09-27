import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from '../KcPage';
import { type StoryName, stories } from '../stories';

function renderStory(name: StoryName) {
  render(<KcPage kcContext={stories[name]()} />);
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('set-password link (info.ftl)', () => {
  it('lands the declarant on "Set your password"', async () => {
    renderStory('actions-landing');

    expect(await heading('Set your password')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set password' }).getAttribute('href')).toBe('#action');
  });

  it('lists the steps for staff', async () => {
    renderStory('actions-landing-staff');

    expect(await heading('Activate your console account')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('confirms the password is set and sends the declarant to sign in', async () => {
    renderStory('actions-done');

    expect(await heading('Your password is set')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      'http://localhost:3000/',
    );
  });

  it('sends staff to the console', async () => {
    renderStory('actions-done-staff');

    expect(await heading('Your console account is active')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to console' })).toBeTruthy();
  });
});

describe('errors (error.ftl)', () => {
  it('sends an expired declarant link to the portal for a new one', async () => {
    renderStory('link-expired');

    expect(await heading('This link has expired')).toBeTruthy();
    expect(screen.getByText('Ask for a new one from the Adili portal.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get a new link' }).getAttribute('href')).toBe(
      'http://localhost:3000/get-started/check-email',
    );
  });

  it('tells staff to ask EACC for a new invitation', async () => {
    renderStory('link-expired-staff');

    expect(await heading('This link has expired')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Get a new link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });

  it('explains a used or broken link', async () => {
    renderStory('link-invalid');

    expect(await heading('This link does not work')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('get a new link from the portal');
  });

  it('explains a disabled account without asking for secrets', async () => {
    renderStory('account-disabled');

    expect(await heading('Your account is disabled')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('never your ID number or password');
  });

  it('tells staff their console access ended', async () => {
    renderStory('account-disabled-staff');

    expect(await heading('Your console access has ended')).toBeTruthy();
  });

  it('falls back to a generic error with Keycloak’s wording', async () => {
    renderStory('error');

    expect(await heading('Something went wrong')).toBeTruthy();
    expect(screen.getByText(/Cookie not found/)).toBeTruthy();
  });
});

describe('other pages', () => {
  it('restarts or continues an expired page', async () => {
    renderStory('page-expired');

    expect(await heading('This page has expired')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue' })).toBeTruthy();
  });

  it('asks before signing out', async () => {
    renderStory('logout');

    expect(await heading('Sign out of Adili Online?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' }).getAttribute('name')).toBe(
      'confirmLogout',
    );
  });

  it('shows the too-many-codes notice on sign in', async () => {
    renderStory('login-otp-locked');

    expect((await screen.findByRole('alert')).textContent).toContain('Too many wrong codes.');
  });
});
