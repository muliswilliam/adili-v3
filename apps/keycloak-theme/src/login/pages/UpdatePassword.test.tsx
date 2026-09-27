import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from '../KcPage';
import { type StoryName, stories } from '../stories';

function renderStory(name: StoryName) {
  render(<KcPage kcContext={stories[name]()} />);
}

const rules = () =>
  screen.getAllByRole('listitem').map((item) => item.textContent.replace(/\s+/g, ' ').trim());

describe('Set your password', () => {
  it('posts the fields Keycloak expects', async () => {
    renderStory('update-password');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Set your password' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('New password').getAttribute('name')).toBe('password-new');
    expect(screen.getByLabelText('Confirm new password').getAttribute('name')).toBe(
      'password-confirm',
    );
    const logout = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Sign out of other devices',
    });
    expect(logout.name).toBe('logout-sessions');
    expect(logout.checked).toBe(true);
  });

  it('lists no rules when Keycloak does not pass the realm policy', async () => {
    renderStory('update-password');
    const input = await screen.findByLabelText('New password');

    expect(screen.queryByRole('list', { name: 'Password rules' })).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it("follows the realm's policy when Keycloak passes it", async () => {
    renderStory('update-password-policy');
    await screen.findByLabelText('New password');

    expect(rules()).toEqual([
      'At least 10 characters (not met yet)',
      'At least 1 number(s) (not met yet)',
      'At least 1 capital letter(s) (not met yet)',
      'Not your email or officer reference',
    ]);
  });

  it('ticks a rule once the password meets it', async () => {
    renderStory('update-password-policy');
    const input = await screen.findByLabelText('New password');

    fireEvent.change(input, { target: { value: 'correct horse' } });
    expect(rules().slice(0, 3)).toEqual([
      'At least 10 characters (met)',
      'At least 1 number(s) (not met yet)',
      'At least 1 capital letter(s) (not met yet)',
    ]);
  });

  it('stops a mismatched confirmation before it is posted', async () => {
    renderStory('update-password');
    fireEvent.change(await screen.findByLabelText('New password'), {
      target: { value: 'correct horse battery' },
    });
    const confirm = screen.getByLabelText('Confirm new password');
    fireEvent.change(confirm, { target: { value: 'correct horse' } });

    const form = confirm.closest('form');
    if (!form) throw new Error('no form');
    const allowed = fireEvent.submit(form);

    expect(allowed).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('The passwords do not match.');
    expect(confirm.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(confirm);
  });

  it("shows the server's refusal in a focused alert", async () => {
    renderStory('update-password-rejected');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Invalid password: must not be equal to any of last 3 passwords.',
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
    expect(screen.getByLabelText('New password').getAttribute('aria-invalid')).toBe('true');
  });

  it('names the staff identifier rule for console users', async () => {
    renderStory('update-password-staff');
    await screen.findByLabelText('New password');

    expect(rules()).toEqual(['At least 12 characters (not met yet)', 'Not your email address']);
  });
});
