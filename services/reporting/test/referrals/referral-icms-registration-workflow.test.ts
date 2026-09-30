import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { referralIcmsRegistration } from '../../src/referrals/workflows.js';
import type { ReferralIcmsActivities } from '../../src/referrals/activities.js';
import {
  ICMS_CHECK_FIRST_DELAY_MS,
  ICMS_CHECK_MAX_DELAY_MS,
  ICMS_REGISTRATION_TIMEOUT_MS,
  type IcmsCheckOutcome,
  type IcmsRegistrationInput,
} from '../../src/referrals/contract.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S12 at the workflow seam: `ReferralIcmsRegistrationWorkflow` against mocked activities in
 * Temporal's time-skipping test environment. ICMS accepted a push without a case number: the
 * workflow asks the gateway with backoff (a minute, then twice as late, at most an hour apart)
 * until the case number is stored, ICMS fails the registration, or the referral moved on; after
 * seven days it leaves the referral `push-failed`. History holds the referral id, the push
 * attempt and outcomes only.
 */
const workflowsPath = fileURLToPath(new URL('../../src/referrals/workflows.ts', import.meta.url));

type Activities = { [K in keyof ReferralIcmsActivities]: ReferralIcmsActivities[K] };

const INPUT: IcmsRegistrationInput = {
  referralId: '0199c000-0000-7000-8000-000000000237',
  attempt: 2,
};

describe('ReferralIcmsRegistrationWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  /** Activities whose checks answer `outcomes` in turn (then `pending`), timed as scheduled. */
  function activities(outcomes: IcmsCheckOutcome[]): {
    mocks: Activities;
    checkedAt: number[];
    workflowId: () => string;
  } {
    const checkedAt: number[] = [];
    let workflowId = '';
    const mocks: Activities = {
      checkIcmsRegistration: vi.fn(() => {
        const { info } = Context.current();
        workflowId = info.workflowExecution?.workflowId ?? '';
        checkedAt.push(info.scheduledTimestampMs);
        return Promise.resolve(outcomes[checkedAt.length - 1] ?? 'pending');
      }),
      recordIcmsTimeout: vi.fn(() => Promise.resolve(true)),
    };
    return { mocks, checkedAt, workflowId: () => workflowId };
  }

  const run = (mocks: Activities) =>
    env.execute(referralIcmsRegistration, { workflowsPath, activities: mocks, args: [INPUT] });

  it('S12: asks ICMS with backoff until the case number is stored', async () => {
    const started = await env.env.currentTimeMs();
    const { mocks, checkedAt } = activities(['pending', 'pending', 'registered']);

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'registered', checks: 3 });
    expect(mocks.checkIcmsRegistration).toHaveBeenCalledWith(INPUT);
    expect(mocks.recordIcmsTimeout).not.toHaveBeenCalled();
    // A minute after the push, then two and four minutes after each earlier check.
    const expected = [1, 3, 7].map((minutes) => started + minutes * ICMS_CHECK_FIRST_DELAY_MS);
    checkedAt.forEach((at, i) => {
      expect(at).toBeGreaterThanOrEqual(expected[i] ?? 0);
      expect(at).toBeLessThan((expected[i] ?? 0) + 30_000);
    });
  }, 60_000);

  it('S12: ends when ICMS fails the registration or the referral moved on', async () => {
    const failed = activities(['pending', 'failed']);
    expect(await run(failed.mocks)).toEqual({ outcome: 'failed', checks: 2 });

    const superseded = activities(['superseded']);
    expect(await run(superseded.mocks)).toEqual({ outcome: 'superseded', checks: 1 });
    expect(superseded.mocks.recordIcmsTimeout).not.toHaveBeenCalled();
  }, 60_000);

  it('S12: without a case number in seven days the referral is left push-failed', async () => {
    const started = await env.env.currentTimeMs();
    const { mocks, checkedAt } = activities([]);

    const result = await run(mocks);

    expect(result.outcome).toBe('timed-out');
    expect(mocks.recordIcmsTimeout).toHaveBeenCalledWith(INPUT);
    const last = checkedAt.at(-1) ?? 0;
    expect(last - started).toBeLessThanOrEqual(ICMS_REGISTRATION_TIMEOUT_MS);
    // Checks settle at an hour apart.
    const gaps = checkedAt.slice(1).map((at, i) => at - (checkedAt[i] ?? 0));
    expect(Math.max(...gaps)).toBeLessThan(ICMS_CHECK_MAX_DELAY_MS + 30_000);
    expect(gaps.at(-1)).toBeGreaterThanOrEqual(ICMS_CHECK_MAX_DELAY_MS);
  }, 60_000);

  it('S12: history holds the referral id, the push attempt and outcomes only', async () => {
    const { mocks, workflowId } = activities(['registered']);

    await run(mocks);

    const payloads = await historyPayloads(env.env.client, workflowId());
    expect(payloads).toContain(INPUT.referralId);
    expect(payloads).not.toMatch(/ICMS\/|RFL-|nationalId|fullName|caseNumber/);
  }, 60_000);
});
