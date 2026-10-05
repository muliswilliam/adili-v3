import { describe, expect, it } from 'vitest';

import { clarificationDueAt } from '../src/clarifications/contract.js';
import { checkedEnvSchema, config } from '../src/config.js';
import { DEFAULT_LADDER_POLICY } from '../src/directory/directory-client.js';
import { stepWindowEndsAt } from '../src/enforcement/windows.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const issuedAt = new Date('2026-10-05T09:00:00Z');
const later = (ms: number) => new Date(issuedAt.getTime() + ms);

describe('demo windows (#371)', () => {
  it('are off with the committed defaults, so every window is the legal one', () => {
    expect(config.DEMO_MODE).toBe(false);
    expect(config.DEMO_CLARIFICATION_REPLY_WINDOW).toBeUndefined();
    expect(config.DEMO_LADDER_NOTICE_WINDOW).toBeUndefined();
    expect(config.DEMO_LADDER_WARNING_WINDOW).toBeUndefined();
    expect(config.DEMO_LADDER_STOPPAGE_WINDOW).toBeUndefined();
  });

  it('are refused unless the service runs in demo mode', () => {
    const env = { ...process.env, DEMO_CLARIFICATION_REPLY_WINDOW: 'PT2M' };
    expect(checkedEnvSchema.safeParse(env).success).toBe(false);
    expect(
      checkedEnvSchema.parse({ ...env, DEMO_MODE: 'true' }).DEMO_CLARIFICATION_REPLY_WINDOW,
    ).toBe(120_000);
  });

  it('due date: the policy reply window, or the demo one when set', () => {
    expect(clarificationDueAt(issuedAt, 30)).toEqual(later(30 * DAY_MS));
    expect(clarificationDueAt(issuedAt, 30, 120_000)).toEqual(later(120_000));
  });

  it('ladder windows: the policy windows, or the demo one for each step when set', () => {
    const policy = DEFAULT_LADDER_POLICY;
    expect(stepWindowEndsAt(issuedAt, policy, 'notice-to-comply')).toEqual(later(14 * DAY_MS));
    expect(stepWindowEndsAt(issuedAt, policy, 'warning')).toEqual(later(14 * DAY_MS));
    expect(stepWindowEndsAt(issuedAt, policy, 'salary-stoppage')).toEqual(later(30 * DAY_MS));
    expect(stepWindowEndsAt(issuedAt, policy, 'disciplinary-referral')).toBeNull();

    const demo = { notice: 60_000, stoppage: 180_000 };
    expect(stepWindowEndsAt(issuedAt, policy, 'notice-to-comply', demo)).toEqual(later(60_000));
    expect(stepWindowEndsAt(issuedAt, policy, 'warning', demo)).toEqual(later(14 * DAY_MS));
    expect(stepWindowEndsAt(issuedAt, policy, 'salary-stoppage', demo)).toEqual(later(180_000));
    expect(stepWindowEndsAt(issuedAt, policy, 'disciplinary-referral', demo)).toBeNull();
  });
});
