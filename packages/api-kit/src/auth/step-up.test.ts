import { describe, expect, it } from 'vitest';

import {
  isFreshStepUp,
  STEP_UP_ACR,
  STEP_UP_CLOCK_SKEW_SECONDS,
  STEP_UP_WINDOW_SECONDS,
} from './step-up.js';

describe('isFreshStepUp', () => {
  const now = new Date('2027-06-30T09:00:00Z');
  const seconds = now.getTime() / 1000;

  it('takes a step-up up to the window old, to the second', () => {
    expect(isFreshStepUp({ acr: STEP_UP_ACR, authTime: seconds }, now)).toBe(true);
    const oldest = seconds - STEP_UP_WINDOW_SECONDS;
    expect(isFreshStepUp({ acr: STEP_UP_ACR, authTime: oldest }, now)).toBe(true);
    expect(isFreshStepUp({ acr: STEP_UP_ACR, authTime: oldest - 1 }, now)).toBe(false);
  });

  it('takes an auth_time ahead of the clock only within the skew', () => {
    const ahead = seconds + STEP_UP_CLOCK_SKEW_SECONDS;
    expect(isFreshStepUp({ acr: STEP_UP_ACR, authTime: ahead }, now)).toBe(true);
    expect(isFreshStepUp({ acr: STEP_UP_ACR, authTime: ahead + 1 }, now)).toBe(false);
  });

  it('refuses another ACR or a token without auth_time', () => {
    expect(isFreshStepUp({ acr: '1', authTime: seconds }, now)).toBe(false);
    expect(isFreshStepUp({ acr: null, authTime: seconds }, now)).toBe(false);
    expect(isFreshStepUp({ acr: STEP_UP_ACR, authTime: null }, now)).toBe(false);
  });

  it('reads now as a Date or epoch milliseconds alike', () => {
    expect(isFreshStepUp({ acr: STEP_UP_ACR, authTime: seconds }, now.getTime())).toBe(true);
  });
});
