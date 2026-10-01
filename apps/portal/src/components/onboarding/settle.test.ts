import { describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../../server/directory/types';
import { settle, type SettleContext } from './settle';

vi.mock('../../server/onboarding', () => ({ leaveOnboarding: vi.fn() }));

function session(state: OnboardingSession['state']): OnboardingSession {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    state,
    commission: {
      slug: 'tsc',
      issuerCode: 'TSC',
      name: 'Teachers Service Commission',
      hasRoster: true,
    },
    contacts: { email: null, phone: null },
    details: null,
    otp: { channel: null, resendAvailableAt: null, resendsLeft: 3, attemptsLeft: 5 },
    outcome: null,
    ofr: null,
    setPasswordEmail: null,
    expiresAt: '2099-01-01T00:00:00Z',
  };
}

function context(overrides: Partial<SettleContext> = {}) {
  const navigate = vi.fn(() => Promise.resolve());
  const invalidate = vi.fn(() => Promise.resolve());
  return {
    navigate,
    invalidate,
    context: {
      route: '/get-started/verify-email',
      commission: 'tsc',
      navigate,
      invalidate,
      ...overrides,
    } satisfies SettleContext,
  };
}

describe('settle', () => {
  it('moves on to the route for the session', async () => {
    const { navigate, context: ctx } = context();

    expect(await settle({ ok: true, session: session('phone-pending') }, ctx)).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: '/get-started/verify-phone' });
  });

  it('hands a session that stays on the step to onStay', async () => {
    const onStay = vi.fn();
    const { navigate, context: ctx } = context({ onStay });
    const next = session('email-pending');

    expect(await settle({ ok: true, session: next }, ctx)).toBeNull();
    expect(onStay).toHaveBeenCalledWith(next);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['ended', 'too-many'] as const)(
    'starts again on %s, keeping the Commission and saying why',
    async (code) => {
      const { navigate, context: ctx } = context();

      expect(await settle({ ok: false, code }, ctx)).toBeNull();
      expect(navigate).toHaveBeenCalledWith({
        to: '/get-started',
        search: { commission: 'tsc', notice: code },
      });
    },
  );

  it('reruns the guard when another tab moved the session on', async () => {
    const { navigate, invalidate, context: ctx } = context();

    expect(await settle({ ok: false, code: 'moved' }, ctx)).toBeNull();
    expect(invalidate).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('hands back any other problem for the step to show', async () => {
    const { navigate, context: ctx } = context();

    expect(await settle({ ok: false, code: 'otp-invalid', attemptsLeft: 2 }, ctx)).toEqual({
      ok: false,
      code: 'otp-invalid',
      attemptsLeft: 2,
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});
