import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReferralActivities } from '../../src/referrals/activities.js';
import {
  type ClarificationSweepChunk,
  type ManifestOutcome,
  type MissedCyclesCandidates,
  type MissedCyclesOutcome,
  type MissedCyclesPage,
  PACKAGE_REFUSED,
  type PersonRef,
  type ReferralSendingInput,
} from '../../src/referrals/contract.js';
import {
  CANDIDATE_PAGE,
  CLARIFICATION_CHUNK,
  referralSending,
  referralSweep,
} from '../../src/referrals/workflows.js';

/**
 * The referral workflows against mocked activities in Temporal's time-skipping test environment
 * (S12 and S13 at the workflow seam): the sending of an approved referral builds the manifest once
 * the approval has committed, then issues the package and marks it sent, in that order; a sending
 * whose approval never committed gives up; a refused package stops before anything is sent.
 * `ReferralSweep` pages through the Commission's candidates for two missed cycles (continuing as
 * new on long runs) and proposes unanswered clarifications a chunk at a time, counting proposals.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

type Activities = { [K in keyof ReferralActivities]: ReferralActivities[K] };

const input: ReferralSendingInput = {
  tenant: 'psc',
  referralId: '0199d000-0000-7000-8000-0000000000a1',
};

/** A person id of candidate `n`. */
const person = (n: number) => `0199d000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('referral workflows', { timeout: 60_000 }, () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  function activities(overrides: Partial<Activities> = {}): {
    mocks: Activities;
    calls: string[];
  } {
    const calls: string[] = [];
    const mocks: Activities = {
      referralSweepTenants: vi.fn(() => {
        calls.push('tenants');
        return Promise.resolve({ tenants: ['psc'], runDate: '2028-03-01' });
      }),
      missedCyclesCandidates: vi.fn((): Promise<MissedCyclesCandidates> => {
        calls.push('candidates');
        return Promise.resolve({ personIds: [], next: null });
      }),
      proposeMissedCycles: vi.fn(({ personId }: PersonRef): Promise<MissedCyclesOutcome> => {
        calls.push(`missed:${personId}`);
        return Promise.resolve('none');
      }),
      proposeUnansweredClarifications: vi.fn(() => {
        calls.push('clarifications');
        return Promise.resolve({ scanned: 0, proposed: 0 });
      }),
      buildManifest: vi.fn((): Promise<ManifestOutcome> => {
        calls.push('manifest');
        return Promise.resolve({ outcome: 'built', items: 7 });
      }),
      issuePackage: vi.fn(() => {
        calls.push('package');
        return Promise.resolve('issued' as const);
      }),
      markSent: vi.fn(() => {
        calls.push('sent');
        return Promise.resolve('sent' as const);
      }),
      ...overrides,
    };
    return { mocks, calls };
  }

  describe('sending (S13)', () => {
    it('builds the manifest once the approval committed, then issues the package and sends', async () => {
      let attempts = 0;
      const { mocks, calls } = activities({
        buildManifest: vi.fn((): Promise<ManifestOutcome> => {
          attempts += 1;
          calls.push('manifest');
          return Promise.resolve(
            attempts < 3 ? { outcome: 'not-approved' } : { outcome: 'built', items: 7 },
          );
        }),
      });

      const result = await env.execute(referralSending, {
        workflowsPath,
        activities: mocks,
        args: [input],
      });

      expect(result).toEqual({ outcome: 'sent', items: 7 });
      expect(calls).toEqual(['manifest', 'manifest', 'manifest', 'package', 'sent']);
      expect(mocks.issuePackage).toHaveBeenCalledWith(input);
      expect(mocks.markSent).toHaveBeenCalledWith(input);
    });

    it('gives up when the approval never committed, issuing nothing', async () => {
      const { mocks, calls } = activities({
        buildManifest: vi.fn((): Promise<ManifestOutcome> => {
          calls.push('manifest');
          return Promise.resolve({ outcome: 'not-approved' });
        }),
      });

      const result = await env.execute(referralSending, {
        workflowsPath,
        activities: mocks,
        args: [input],
      });

      expect(result).toEqual({ outcome: 'not-approved' });
      expect(calls.filter((call) => call === 'manifest')).toHaveLength(61);
      expect(calls).not.toContain('package');
      expect(calls).not.toContain('sent');
    });

    it('sends nothing when documents refuses the package', async () => {
      const { mocks, calls } = activities({
        issuePackage: vi.fn(() => {
          calls.push('package');
          return Promise.reject(ApplicationFailure.nonRetryable('refused', PACKAGE_REFUSED));
        }),
      });

      await expect(
        env.execute(referralSending, { workflowsPath, activities: mocks, args: [input] }),
      ).rejects.toThrow();
      expect(calls).toEqual(['manifest', 'package']);
    });
  });

  describe('ReferralSweep (S12)', () => {
    it('pages through the candidates, then proposes unanswered clarifications a chunk at a time', async () => {
      const pages: MissedCyclesCandidates[] = [
        { personIds: [person(1), person(2)], next: person(2) },
        { personIds: [person(3)], next: null },
      ];
      const { mocks, calls } = activities({
        missedCyclesCandidates: vi.fn(({ after, limit }: MissedCyclesPage) => {
          calls.push(`candidates:${after ?? 'start'}:${String(limit)}`);
          const page = after === null ? pages[0] : pages[1];
          if (!page) throw new Error('no such page');
          return Promise.resolve(page);
        }),
        proposeMissedCycles: vi.fn(({ personId }: PersonRef): Promise<MissedCyclesOutcome> => {
          calls.push(`missed:${personId}`);
          if (personId === person(1)) return Promise.resolve('proposed');
          return Promise.resolve(personId === person(2) ? 'already-proposed' : 'none');
        }),
        proposeUnansweredClarifications: vi.fn(({ limit }: ClarificationSweepChunk) => {
          const chunk = calls.filter((call) => call.startsWith('clarifications')).length;
          calls.push(`clarifications:${String(limit)}`);
          return Promise.resolve(
            chunk === 0 ? { scanned: limit, proposed: limit - 1 } : { scanned: 3, proposed: 3 },
          );
        }),
      });

      const result = await env.execute(referralSweep, {
        workflowsPath,
        activities: mocks,
        args: [{ tenant: 'psc' }],
      });

      expect(result).toEqual({
        twoMissedCycles: 1,
        unansweredClarifications: CLARIFICATION_CHUNK - 1 + 3,
      });
      expect(calls).toEqual([
        `candidates:start:${String(CANDIDATE_PAGE)}`,
        `missed:${person(1)}`,
        `missed:${person(2)}`,
        `candidates:${person(2)}:${String(CANDIDATE_PAGE)}`,
        `missed:${person(3)}`,
        `clarifications:${String(CLARIFICATION_CHUNK)}`,
        `clarifications:${String(CLARIFICATION_CHUNK)}`,
      ]);
    });

    it('continues as new on a long run, keeping its place and its count', async () => {
      const { mocks } = activities({
        missedCyclesCandidates: vi.fn(({ after }: MissedCyclesPage) => {
          const n = after === null ? 1 : Number(after.slice(-12)) + 1;
          return Promise.resolve({ personIds: [person(n)], next: n < 25 ? person(n) : null });
        }),
        proposeMissedCycles: vi.fn((): Promise<MissedCyclesOutcome> => Promise.resolve('proposed')),
      });

      const result = await env.execute(referralSweep, {
        workflowsPath,
        activities: mocks,
        args: [{ tenant: 'psc' }],
      });

      expect(result).toEqual({ twoMissedCycles: 25, unansweredClarifications: 0 });
      expect(mocks.proposeMissedCycles).toHaveBeenCalledTimes(25);
    });
  });
});
