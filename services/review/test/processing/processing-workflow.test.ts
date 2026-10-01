import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ProcessingActivities } from '../../src/processing/activities.js';
import {
  type PreviousVersion,
  type ProcessingInput,
  type RulesRequest,
  type UpsertCaseRequest,
  VERSION_MISSING,
  type VersionFacts,
} from '../../src/processing/contract.js';
import { declarationProcessing } from '../../src/processing/workflows.js';
import type { RegistryCheckActivities } from '../../src/registry/activities.js';
import type { RegistryCheckResult, RegistryLookups } from '../../src/registry/contract.js';
import type { Flag } from '../../src/rules/index.js';
import { declaration, statement } from '../fixtures/declarations.js';
import { FakeDeclarations, submittedVersion } from '../support/fake-declarations.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * `DeclarationProcessingWorkflow` against mocked activities in Temporal's time-skipping test
 * environment: the order of its steps, what passes between them, and retries of failed pulls.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

type Activities = { [K in keyof ProcessingActivities]: ProcessingActivities[K] } & {
  [K in keyof RegistryCheckActivities]: RegistryCheckActivities[K];
};

const lookups: RegistryLookups = {
  persons: {
    officer: {
      kra: { outcome: 'found', reason: null, resultId: 'r-kra', checkedAt: '2027-12-10T09:00:00Z' },
    },
  },
  suppliers: {},
};
const checked: RegistryCheckResult = { outcome: 'checked', flags: 0, statuses: [] };

const input: ProcessingInput = {
  tenant: 'psc',
  declarationId: '0199b000-0000-7000-8000-000000000001',
  versionId: '0199b000-0000-7000-8000-000000000002',
  version: 1,
};

const facts: VersionFacts = {
  personId: '0199b000-0000-7000-8000-0000000000aa',
  reference: 'DEC-PSC-2027-0000001-7',
  type: 'biennial',
  statementDate: '2027-11-01',
  submittedAt: '2027-12-10T09:00:00.000Z',
  late: false,
  dueDate: '2027-12-31',
};

const noPrevious: Flag = {
  ruleId: 'no-previous-version',
  severity: 'info',
  title: 'First declaration on Adili',
  indicator: 'No earlier version to compare with.',
  evidence: {},
  itemRefs: [],
};

function activities(overrides: Partial<Activities> = {}): Activities {
  return {
    pullVersion: vi.fn(() => Promise.resolve(facts)),
    pullPreviousVersion: vi.fn(() => Promise.resolve<PreviousVersion | null>(null)),
    runRules: vi.fn(() => Promise.resolve([noPrevious])),
    upsertCase: vi.fn(() => Promise.resolve({ outcome: 'created' as const, caseId: 'case-1' })),
    lookupRegistries: vi.fn(() => Promise.resolve<RegistryLookups | null>(lookups)),
    matchRegistries: vi.fn(() => Promise.resolve(checked)),
    registrySweepCandidates: vi.fn(() => Promise.resolve([])),
    ...overrides,
  };
}

describe('DeclarationProcessingWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  it('pulls the version and the previous one, runs the rules, creates the case, then checks the registries for it', async () => {
    const mocks = activities();

    const result = await env.execute(declarationProcessing, {
      workflowsPath,
      activities: mocks,
      args: [input],
    });

    expect(result).toEqual({ outcome: 'created', caseId: 'case-1' });
    expect(mocks.pullVersion).toHaveBeenCalledWith(input);
    expect(mocks.pullPreviousVersion).toHaveBeenCalledWith({
      tenant: 'psc',
      personId: facts.personId,
      versionId: input.versionId,
    });
    expect(mocks.runRules).toHaveBeenCalledWith({
      input,
      facts,
      previous: null,
    } satisfies RulesRequest);
    expect(mocks.upsertCase).toHaveBeenCalledWith({
      input,
      facts,
      flags: [noPrevious],
    } satisfies UpsertCaseRequest);
    // S9: the lookups come after the rules, for the case the version is now on.
    const check = { ...input, caseId: 'case-1' };
    expect(mocks.lookupRegistries).toHaveBeenCalledWith({ check, previous: null });
    expect(mocks.matchRegistries).toHaveBeenCalledWith({ check, lookups });
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0] ?? 0;
    expect(order(mocks.upsertCase)).toBeLessThan(order(mocks.lookupRegistries));
  }, 60_000);

  it('S9: a registry check that fails for good leaves the case created', async () => {
    const matchRegistries = vi.fn(() =>
      Promise.reject(ApplicationFailure.nonRetryable('gone', VERSION_MISSING)),
    );

    const result = await env.execute(declarationProcessing, {
      workflowsPath,
      activities: activities({ matchRegistries }),
      args: [input],
    });

    expect(result).toEqual({ outcome: 'created', caseId: 'case-1' });
    expect(matchRegistries).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('checks the registries of an amended case, and of one already at the version (a re-run)', async () => {
    for (const outcome of ['updated', 'unchanged'] as const) {
      const mocks = activities({
        upsertCase: vi.fn(() => Promise.resolve({ outcome, caseId: 'case-1' })),
      });

      const result = await env.execute(declarationProcessing, {
        workflowsPath,
        activities: mocks,
        args: [input],
      });

      expect(result).toEqual({ outcome, caseId: 'case-1' });
      expect(mocks.matchRegistries).toHaveBeenCalledTimes(1);
    }
  }, 60_000);

  it('hands the previous version to the rules', async () => {
    const previous: PreviousVersion = {
      declarationId: '0199b000-0000-7000-8000-0000000000b1',
      versionId: '0199b000-0000-7000-8000-0000000000b2',
      version: 1,
    };
    const mocks = activities({ pullPreviousVersion: vi.fn(() => Promise.resolve(previous)) });

    await env.execute(declarationProcessing, { workflowsPath, activities: mocks, args: [input] });

    expect(mocks.runRules).toHaveBeenCalledWith({ input, facts, previous });
  }, 60_000);

  it('retries failed pulls with backoff until they succeed', async () => {
    const attempts: { activity: string; attempt: number; at: number }[] = [];
    const flaky = <T>(activity: string, failures: number, value: T) =>
      vi.fn(async () => {
        const attempt = Context.current().info.attempt;
        attempts.push({ activity, attempt, at: await env.env.currentTimeMs() });
        if (attempt <= failures) throw new Error('declarations unreachable');
        return value;
      });
    const mocks = activities({
      pullVersion: flaky('pullVersion', 2, facts),
      pullPreviousVersion: flaky<PreviousVersion | null>('pullPreviousVersion', 1, null),
    });

    const result = await env.execute(declarationProcessing, {
      workflowsPath,
      activities: mocks,
      args: [input],
    });

    expect(result).toEqual({ outcome: 'created', caseId: 'case-1' });
    const pulls = attempts.filter((a) => a.activity === 'pullVersion');
    expect(pulls.map((a) => a.attempt)).toEqual([1, 2, 3]);
    // Backoff: about a second before the first retry, about two before the second.
    const [first, second, third] = pulls.map((a) => a.at);
    expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(1_000);
    expect((third ?? 0) - (second ?? 0)).toBeGreaterThanOrEqual(2_000);
    expect(attempts.filter((a) => a.activity === 'pullPreviousVersion')).toHaveLength(2);
    expect(mocks.upsertCase).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('ends without a case when declarations has no such version', async () => {
    const mocks = activities({ pullVersion: vi.fn(() => Promise.resolve(null)) });

    const result = await env.execute(declarationProcessing, {
      workflowsPath,
      activities: mocks,
      args: [input],
    });

    expect(result).toEqual({ outcome: 'missing' });
    expect(mocks.runRules).not.toHaveBeenCalled();
    expect(mocks.upsertCase).not.toHaveBeenCalled();
    expect(mocks.lookupRegistries).not.toHaveBeenCalled();
  }, 60_000);

  it("keeps the declarant's name and personnel file number out of the workflow history", async () => {
    const declarations = new FakeDeclarations();
    declarations.given(
      submittedVersion({
        tenant: input.tenant,
        declarationId: input.declarationId,
        versionId: input.versionId,
        declarantName: 'James Otieno',
        personnelFileNumber: 'PSC/2019/0042',
        document: declaration([statement('officer')]),
      }),
    );
    // The real pull, against the fake declarations service: what it hands on enters the history.
    const real = new ProcessingActivities(
      undefined as never,
      undefined as never,
      declarations,
      undefined as never,
    );
    let workflowId = '';
    const mocks = activities({
      pullVersion: (request) => real.pullVersion(request),
      upsertCase: vi.fn(() => {
        workflowId = Context.current().info.workflowExecution?.workflowId ?? '';
        return Promise.resolve({ outcome: 'created' as const, caseId: 'case-1' });
      }),
    });

    await env.execute(declarationProcessing, { workflowsPath, activities: mocks, args: [input] });

    const history = await historyPayloads(env.env.client, workflowId);
    expect(history).toContain(input.versionId);
    expect(history).not.toContain('James Otieno');
    expect(history).not.toContain('PSC/2019/0042');
  }, 60_000);

  it('does not retry a version that disappeared between pulls', async () => {
    const runRules = vi.fn(() =>
      Promise.reject(ApplicationFailure.nonRetryable('gone', VERSION_MISSING)),
    );

    await expect(
      env.execute(declarationProcessing, {
        workflowsPath,
        activities: activities({ runRules }),
        args: [input],
      }),
    ).rejects.toThrow();
    expect(runRules).toHaveBeenCalledTimes(1);
  }, 60_000);
});
