import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from '../KcPage';
import { getKcContextMock, PORTAL_URL } from '../mock';
import { stories } from '../stories';

const heading = () => screen.findByRole('heading', { level: 1, name: 'Sign out of Adili Online?' });

describe('logout-confirm.ftl', () => {
  it('asks a declarant before signing out, with a way back', async () => {
    const kcContext = stories.logout();
    const { container } = render(<KcPage kcContext={kcContext} />);

    expect(await heading()).toBeTruthy();
    expect(screen.getByText('Your saved declaration stays safe.')).toBeTruthy();
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut.getAttribute('name')).toBe('confirmLogout');
    expect(signOut.closest('form')?.getAttribute('action')).toBe(kcContext.url.logoutConfirmAction);
    expect(container.querySelector<HTMLInputElement>('input[name="session_code"]')?.value).toBe(
      kcContext.logoutConfirm.code,
    );
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe(PORTAL_URL);
  });

  it('reminds staff what signing in again takes', async () => {
    render(<KcPage kcContext={stories['logout-staff']()} />);

    expect(await heading()).toBeTruthy();
    expect(
      screen.getByText('You will need your password and authenticator code to sign in again.'),
    ).toBeTruthy();
  });

  it('leaves out Cancel when there is nowhere to go back to', async () => {
    render(
      <KcPage
        kcContext={getKcContextMock({
          pageId: 'logout-confirm.ftl',
          overrides: { logoutConfirm: { skipLink: true } },
        })}
      />,
    );

    expect(await heading()).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull();
  });
});
