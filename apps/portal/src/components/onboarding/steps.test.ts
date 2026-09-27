import { describe, expect, it } from 'vitest';

import type { OnboardingState } from '../../server/directory/types';
import { contractEnum } from '../../test/contract';
import { routeForSession, STEP_ROUTES } from './steps';

// S24: every session state maps to exactly one route.
describe('routeForSession', () => {
  const states = contractEnum('OnboardingState') as OnboardingState[];

  it('reads the states from the contract', () => {
    expect(states).toContain('email-pending');
    expect(states).toContain('identity-mismatch');
  });

  it.each(states)('maps %s to one known route', (state) => {
    const route = routeForSession({ state, outcome: null });
    expect(STEP_ROUTES).toContain(route);
  });

  it('sends each verification stage to its own step', () => {
    expect(routeForSession({ state: 'email-pending', outcome: null })).toBe(
      '/get-started/verify-email',
    );
    expect(routeForSession({ state: 'email-contact-required', outcome: null })).toBe(
      '/get-started/verify-email',
    );
    expect(routeForSession({ state: 'email-verified', outcome: null })).toBe(
      '/get-started/verify-phone',
    );
    expect(routeForSession({ state: 'phone-verified', outcome: null })).toBe(
      '/get-started/confirm',
    );
    expect(routeForSession({ state: 'identity-mismatch', outcome: null })).toBe(
      '/get-started/not-verified',
    );
    expect(routeForSession({ state: 'expired', outcome: null })).toBe('/get-started');
  });

  it('splits a confirmed session on its outcome', () => {
    expect(routeForSession({ state: 'confirmed', outcome: 'account-created' })).toBe(
      '/get-started/check-email',
    );
    expect(routeForSession({ state: 'confirmed', outcome: 'linked-existing-account' })).toBe(
      '/get-started/done',
    );
  });

  it('leaves no step route unreachable', () => {
    const reached = new Set([
      ...states.map((state) => routeForSession({ state, outcome: null })),
      routeForSession({ state: 'confirmed', outcome: 'linked-existing-account' }),
    ]);
    // Identify comes before there is a session: the Commission step links to it.
    const afterIdentify = STEP_ROUTES.filter((route) => route !== '/get-started/identify');
    expect([...reached].sort()).toEqual([...afterIdentify].sort());
  });
});
