import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from '../KcPage';
import { getKcContextMock } from '../mock';
import { type StoryName, stories } from '../stories';

function renderStory(name: StoryName) {
  render(<KcPage kcContext={stories[name]()} />);
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('info.ftl', () => {
  it('lands the declarant on "Set your password" with a one-time link', async () => {
    renderStory('actions-landing');

    expect(await heading('Set your password')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set password' }).getAttribute('href')).toBe('#action');
    expect(screen.getByText('This link works once.')).toBeTruthy();
    // Declarants have one action; the list is for staff.
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('lists the steps for staff', async () => {
    renderStory('actions-landing-staff');

    expect(await heading('Activate your console account')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Start' })).toBeTruthy();
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
    expect(screen.getByRole('link', { name: 'Go to console' }).getAttribute('href')).toBe(
      'http://localhost:3010/',
    );
  });

  it('shows any other notice with Keycloak’s wording and a way on', async () => {
    render(
      <KcPage
        kcContext={getKcContextMock({
          pageId: 'info.ftl',
          overrides: {
            messageHeader: undefined,
            requiredActions: undefined,
            pageRedirectUri: 'http://localhost:3000/next',
            message: { type: 'info', summary: 'Your email address has been verified.' },
          },
        })}
      />,
    );

    expect(await heading('Your email address has been verified.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe(
      'http://localhost:3000/next',
    );
  });

  it('leaves out the way on when Keycloak says to skip it', async () => {
    render(
      <KcPage
        kcContext={getKcContextMock({
          pageId: 'info.ftl',
          overrides: {
            messageHeader: undefined,
            requiredActions: undefined,
            skipLink: true,
            message: { type: 'info', summary: 'You may close this window.' },
          },
        })}
      />,
    );

    expect(await heading('You may close this window.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull();
  });
});
