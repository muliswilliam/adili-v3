import { describe, expect, it } from 'vitest';

import { authErrorMessage } from './auth-error';

describe('authErrorMessage', () => {
  it('shows nothing without an error', () => {
    expect(authErrorMessage(undefined)).toBeNull();
  });

  it('explains known errors', () => {
    expect(authErrorMessage('access_denied')).toMatch(/cancelled/);
    expect(authErrorMessage('login_expired')).toMatch(/expired/);
  });

  it('never echoes unknown codes back to the page', () => {
    expect(authErrorMessage('<script>')).toBe('We could not sign you in. Please try again.');
  });
});
