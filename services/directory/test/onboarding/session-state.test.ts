import { describe, expect, it } from 'vitest';

import {
  canTransition,
  confirmedExpiry,
  extendedExpiry,
  hasExpired,
  initialExpiry,
  ONBOARDING_STATES,
  TERMINAL_STATES,
} from '../../src/onboarding/session-state.js';
import { contactRequiredChannel, pendingChannel } from '../../src/onboarding/channels.js';

const MINUTE = 60 * 1000;
const created = new Date('2026-10-01T09:00:00Z');

describe('onboarding session state machine', () => {
  it('walks email then phone, with a contact step where the record lacks one', () => {
    expect(canTransition('identified', 'email-pending')).toBe(true);
    expect(canTransition('identified', 'email-contact-required')).toBe(true);
    expect(canTransition('email-contact-required', 'email-pending')).toBe(true);
    expect(canTransition('email-pending', 'email-verified')).toBe(true);
    expect(canTransition('email-verified', 'phone-contact-required')).toBe(true);
    expect(canTransition('phone-pending', 'phone-verified')).toBe(true);
    expect(canTransition('phone-verified', 'confirmed')).toBe(true);
    expect(canTransition('phone-verified', 'identity-mismatch')).toBe(true);
  });

  it('refuses skipped steps and moves out of terminal states', () => {
    expect(canTransition('identified', 'phone-pending')).toBe(false);
    expect(canTransition('email-pending', 'phone-verified')).toBe(false);
    expect(canTransition('email-verified', 'confirmed')).toBe(false);
    for (const terminal of TERMINAL_STATES) {
      for (const state of ONBOARDING_STATES) expect(canTransition(terminal, state)).toBe(false);
    }
  });

  it('lets every live state expire', () => {
    const live = ONBOARDING_STATES.filter(
      (state) => !(TERMINAL_STATES as readonly string[]).includes(state),
    );
    for (const state of live) expect(canTransition(state, 'expired')).toBe(true);
  });

  it('names the channel a pending state waits for', () => {
    expect(pendingChannel('email-pending')).toBe('email');
    expect(pendingChannel('phone-pending')).toBe('phone');
    expect(pendingChannel('email-verified')).toBeNull();
    expect(contactRequiredChannel('phone-contact-required')).toBe('phone');
    expect(contactRequiredChannel('email-pending')).toBeNull();
  });

  it('lives 24 hours after a confirm with a new account, as long as the set-password link', () => {
    expect(confirmedExpiry(created).getTime() - created.getTime()).toBe(24 * 60 * MINUTE);
  });

  it('lives 30 minutes, 10 more per step, at most 60', () => {
    const expiresAt = initialExpiry(created);
    expect(expiresAt.getTime() - created.getTime()).toBe(30 * MINUTE);
    const once = extendedExpiry({ createdAt: created, expiresAt });
    expect(once.getTime() - created.getTime()).toBe(40 * MINUTE);
    let later = once;
    for (let step = 0; step < 5; step++)
      later = extendedExpiry({ createdAt: created, expiresAt: later });
    expect(later.getTime() - created.getTime()).toBe(60 * MINUTE);
  });

  it('has expired at its expiry, or once ended as expired', () => {
    const expiresAt = initialExpiry(created);
    const justBefore = new Date(expiresAt.getTime() - 1);
    expect(hasExpired({ state: 'email-pending', expiresAt }, justBefore)).toBe(false);
    expect(hasExpired({ state: 'email-pending', expiresAt }, expiresAt)).toBe(true);
    expect(hasExpired({ state: 'expired', expiresAt }, justBefore)).toBe(true);
  });
});
