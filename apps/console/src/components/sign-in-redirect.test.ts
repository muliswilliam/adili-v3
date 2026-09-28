import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentPage, goToSignIn, signInUrl } from './sign-in-redirect';

describe('signInUrl', () => {
  it('returns to the path and query after signing in', () => {
    expect(signInUrl('/roster/records?q=otieno&flagged=true')).toBe(
      '/auth/login?returnTo=%2Froster%2Frecords%3Fq%3Dotieno%26flagged%3Dtrue',
    );
  });
});

describe('goToSignIn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubLocation(pathname: string, search: string) {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname, search, assign } });
    return assign;
  }

  it('returns to the page the browser is on, query included, by default', () => {
    const assign = stubLocation('/commissions/psc/records/abc', '?from=flagged');

    goToSignIn();

    expect(currentPage()).toBe('/commissions/psc/records/abc?from=flagged');
    expect(assign).toHaveBeenCalledWith(signInUrl('/commissions/psc/records/abc?from=flagged'));
  });

  it('returns to the given page', () => {
    const assign = stubLocation('/roster/import', '');

    goToSignIn('/roster/import?import=0191');

    expect(assign).toHaveBeenCalledWith('/auth/login?returnTo=%2Froster%2Fimport%3Fimport%3D0191');
  });
});
