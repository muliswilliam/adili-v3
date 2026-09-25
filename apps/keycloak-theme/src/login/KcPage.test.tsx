import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from './KcPage';
import { getKcContextMock } from './mock';

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
});
