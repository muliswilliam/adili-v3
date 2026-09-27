import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from '../KcPage';
import { getKcContextMock } from '../mock';
import { stories } from '../stories';

const heading = () => screen.findByRole('heading', { level: 1, name: 'Reset your password' });

describe('login-reset-password.ftl', () => {
  it('asks a declarant for their email or officer reference', async () => {
    const kcContext = stories['reset-password']();
    render(<KcPage kcContext={kcContext} />);

    expect(await heading()).toBeTruthy();
    expect(screen.getByText('We will email you a reset link.')).toBeTruthy();
    const field = screen.getByLabelText<HTMLInputElement>('Email or officer reference');
    expect(field.type).toBe('text');
    expect(field.name).toBe('username');
    expect(screen.getByText('Email changed? Ask your reporting officer.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      kcContext.url.loginUrl,
    );
  });

  it('asks staff for their official email', async () => {
    render(
      <KcPage
        kcContext={getKcContextMock({
          pageId: 'login-reset-password.ftl',
          overrides: { client: { clientId: 'console' } },
        })}
      />,
    );

    expect(await heading()).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Official email').type).toBe('email');
    expect(screen.getByText('Lost access to this email? Ask EACC.')).toBeTruthy();
  });

  it('keeps what was typed and shows Keycloak’s error on the field', async () => {
    render(
      <KcPage
        kcContext={getKcContextMock({
          pageId: 'login-reset-password.ftl',
          overrides: {
            auth: { attemptedUsername: 'OFR-0000418-X' },
            messagesPerField: {
              existsError: (...names: string[]) => names.includes('username'),
              get: (name: string) => (name === 'username' ? 'Please specify username.' : ''),
            },
          },
        })}
      />,
    );

    expect(await heading()).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Please specify username.');
    const field = screen.getByLabelText<HTMLInputElement>('Email or officer reference');
    expect(field.value).toBe('OFR-0000418-X');
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('holds the button once the form is sent', async () => {
    render(<KcPage kcContext={stories['reset-password']()} />);
    await heading();

    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Send reset link' });
    const form = button.closest('form');
    if (!form) throw new Error('the button is not in a form');
    fireEvent.submit(form);

    expect(button.disabled).toBe(true);
  });
});
