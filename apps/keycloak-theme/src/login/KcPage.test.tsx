import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import KcPage from './KcPage';
import { getKcContextMock } from './mock';
import { stories } from './stories';

describe('login theme', () => {
  it('renders the branded sign-in form', async () => {
    render(<KcPage kcContext={getKcContextMock({ pageId: 'login.ftl', overrides: {} })} />);

    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByText('Adili Online')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
  });

  it('shows credential errors next to the fields', async () => {
    render(
      <KcPage
        kcContext={getKcContextMock({
          pageId: 'login.ftl',
          overrides: {
            messagesPerField: {
              existsError: (...fields: string[]) => fields.includes('password'),
              getFirstError: () => 'Invalid username or password.',
            },
          },
        })}
      />,
    );

    const error = await screen.findByText('Invalid username or password.');
    expect(error.id).toBe('input-error');
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true');
  });

  // Regression: the authenticator set-up page could stay blank. Each page was a script loaded on
  // demand, and one that failed or hung left nothing on screen. Pages now come with the theme.
  it('renders a page without loading another script first', async () => {
    // A fresh module graph, as on a real page load: nothing loaded by an earlier test.
    vi.resetModules();
    const { default: FreshKcPage } = await import('./KcPage');

    render(<FreshKcPage kcContext={stories['configure-totp']()} />);
    await act(() => Promise.resolve());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Set up your authenticator app' }),
    ).toBeTruthy();
  });
});
