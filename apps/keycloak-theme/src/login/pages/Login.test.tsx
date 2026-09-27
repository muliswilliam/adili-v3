import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from '../KcPage';
import { type StoryName, stories } from '../stories';

function renderStory(name: StoryName) {
  render(<KcPage kcContext={stories[name]()} />);
}

describe('notices other pages send back to sign in (login.ftl)', () => {
  it('shows the too-many-codes notice', async () => {
    renderStory('login-otp-locked');

    expect((await screen.findByRole('alert')).textContent).toContain('Too many wrong codes.');
  });

  it('explains a sign-in that took too long', async () => {
    renderStory('login-timeout');

    expect(await screen.findByText(/Your sign-in took too long/)).toBeTruthy();
  });
});
