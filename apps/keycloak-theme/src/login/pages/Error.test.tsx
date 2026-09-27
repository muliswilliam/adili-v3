import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from '../KcPage';
import { getKcContextMock, PORTAL_URL } from '../mock';
import { type StoryName, stories } from '../stories';

function renderStory(name: StoryName) {
  render(<KcPage kcContext={stories[name]()} />);
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('error.ftl', () => {
  it('sends a declarant with an expired link to the portal for a new one', async () => {
    renderStory('link-expired');

    expect(await heading('This link has expired')).toBeTruthy();
    expect(screen.getByText('Ask for a new one from the Adili portal.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get a new link' }).getAttribute('href')).toBe(
      `${PORTAL_URL}get-started/check-email`,
    );
    // The portal page explains Forgot password when opened without its session; this says so
    // for a declarant on another device.
    expect(screen.getByRole('note').textContent).toContain('Use "Forgot password"');
    expect(screen.queryByRole('link', { name: 'Back to sign in' })).toBeNull();
  });

  it('falls back to sign in when Keycloak gives no portal address', async () => {
    render(
      <KcPage
        kcContext={getKcContextMock({
          pageId: 'error.ftl',
          overrides: {
            client: { baseUrl: undefined },
            message: { type: 'error', summary: 'Action expired. Please start again.' },
          },
        })}
      />,
    );

    expect(await heading('This link has expired')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Get a new link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });

  it('tells staff to ask EACC for a new invitation', async () => {
    renderStory('link-expired-staff');

    expect(await heading('This link has expired')).toBeTruthy();
    expect(screen.getByText(/Ask EACC to resend your invitation/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Get a new link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      'http://localhost:3010/',
    );
  });

  it('explains a used or broken link and offers sign in first', async () => {
    renderStory('link-invalid');

    expect(await heading('This link does not work')).toBeTruthy();
    expect(screen.getByText('It may be used already, or copied only in part.')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('get a new link from the portal');
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe(
      PORTAL_URL,
    );
  });

  it('explains a disabled account without asking for secrets', async () => {
    renderStory('account-disabled');

    expect(await heading('Your account is disabled')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('never your ID number or password');
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });

  it('tells staff their console access ended', async () => {
    renderStory('account-disabled-staff');

    expect(await heading('Your console access has ended')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('EACC platform team');
  });

  it('falls back to a generic error with Keycloak’s wording and who to contact', async () => {
    renderStory('error');

    expect(await heading('Something went wrong')).toBeTruthy();
    expect(screen.getByText(/Cookie not found/)).toBeTruthy();
    expect(
      screen.getByText("If it keeps happening, contact your Commission's reporting officer."),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });

  it('sanitises Keycloak’s wording', async () => {
    render(
      <KcPage
        kcContext={getKcContextMock({
          pageId: 'error.ftl',
          overrides: {
            message: { type: 'error', summary: 'Oops<img src=x onerror="alert(1)">' },
          },
        })}
      />,
    );

    expect(await heading('Something went wrong')).toBeTruthy();
    expect(document.querySelector('img[onerror]')).toBeNull();
  });
});
