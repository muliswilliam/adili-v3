// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CredentialField, HIDDEN_SECRET } from './credential-field';

const SECRET = 'q7Hn2vXkP9sLr4TzW8cBf3YmJd6GaE1u';

function renderField(props: Parameters<typeof CredentialField>[0]) {
  return render(
    <ToastProvider>
      <CredentialField {...props} />
    </ToastProvider>,
  );
}

function mockClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CredentialField', () => {
  it('shows a plain value in a group named by its label, with a Copy button', () => {
    renderField({ label: 'Client ID', value: 'roster-psc-3f9a2c1d' });

    const group = screen.getByRole('group', { name: 'Client ID' });
    expect(within(group).getByText('roster-psc-3f9a2c1d')).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Copy client ID' }).textContent).toBe('Copy');
    expect(within(group).queryByRole('button', { name: /client secret/ })).toBeNull();
  });

  it('hides a secret until revealed, and hides it again', () => {
    renderField({ label: 'Client secret', value: SECRET, secret: true });

    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByText(HIDDEN_SECRET)).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();

    const show = screen.getByRole('button', { name: 'Show client secret' });
    expect(show.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(show);

    expect(screen.getByText(SECRET)).toBeTruthy();
    const hide = screen.getByRole('button', { name: 'Hide client secret' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(hide);

    expect(screen.queryByText(SECRET)).toBeNull();
  });

  it('copies the real secret while it is hidden and confirms with a toast', async () => {
    const writeText = mockClipboard();
    renderField({ label: 'Client secret', value: SECRET, secret: true });

    fireEvent.click(screen.getByRole('button', { name: 'Copy client secret' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SECRET);
    });
    expect(await screen.findByText('Client secret copied')).toBeTruthy();
  });
});
