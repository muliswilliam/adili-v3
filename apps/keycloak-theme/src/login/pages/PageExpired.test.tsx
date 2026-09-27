import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from '../KcPage';
import { stories } from '../stories';

describe('login-page-expired.ftl', () => {
  it('restarts sign in or continues where the declarant was', async () => {
    const kcContext = stories['page-expired']();
    render(<KcPage kcContext={kcContext} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page has expired' }),
    ).toBeTruthy();
    expect(
      screen.getByText('You may have waited too long, or opened sign-in in another tab.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start again' }).getAttribute('href')).toBe(
      kcContext.url.loginRestartFlowUrl,
    );
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe(
      kcContext.url.loginAction,
    );
  });
});
