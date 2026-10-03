import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { WorkflowFailedError } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { InternalApiRejected } from '../../src/internal-api/internal-api.js';
import type { OpenDataReleaseActivities } from '../../src/open-data/activities.js';
import {
  type OpenDataReleaseInput,
  openDataReleaseWorkflowId,
} from '../../src/open-data/contract.js';
import { NcrNotApproved, ReconciliationFailed } from '../../src/open-data/release-builder.js';
import { openDataRelease } from '../../src/open-data/workflows.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S5 at the workflow seam: `OpenDataReleaseWorkflow` against mocked activities in Temporal's
 * time-skipping test environment. It builds the release, issues its manifest, then publishes it,
 * in that order; an outage or an approval not yet committed is retried, while a release that does
 * not reconcile, or a manifest documents refuses, fails the workflow with nothing after it done.
 * History holds ids, the year, the kind, the version and the manifest's code only.
 */
const workflowsPath = fileURLToPath(new URL('../../src/open-data/workflows.ts', import.meta.url));

type Activities = { [K in keyof OpenDataReleaseActivities]: OpenDataReleaseActivities[K] };

const INPUT: OpenDataReleaseInput = {
  releaseId: '0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c10',
  fy: 2027,
  kind: 'annual',
};
const MANIFEST = { documentId: '0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c11', verificationId: 'ADL-TEST' };

describe('OpenDataReleaseWorkflow', () => {
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
      buildRelease: vi.fn(() => {
        calls.push('build');
        return Promise.resolve({ version: 2 });
      }),
      issueReleaseManifest: vi.fn(() => {
        calls.push('manifest');
        return Promise.resolve(MANIFEST);
      }),
      publishRelease: vi.fn(() => {
        calls.push('publish');
        return Promise.resolve();
      }),
      ...overrides,
    };
    return { mocks, calls };
  }

  const run = (mocks: Activities, workflowId = openDataReleaseWorkflowId(INPUT)) =>
    env.execute(openDataRelease, { workflowsPath, activities: mocks, args: [INPUT], workflowId });

  it('S5: builds, issues the manifest, then publishes; history holds ids and the version only', async () => {
    const { mocks, calls } = activities();
    const workflowId = `${openDataReleaseWorkflowId(INPUT)}:history`;

    await expect(run(mocks, workflowId)).resolves.toEqual({
      releaseId: INPUT.releaseId,
      version: 2,
      ...MANIFEST,
    });

    expect(calls).toEqual(['build', 'manifest', 'publish']);
    for (const mock of Object.values(mocks)) expect(mock).toHaveBeenCalledWith(INPUT);
    const history = await historyPayloads(env.env.client, workflowId);
    expect(history).toContain(INPUT.releaseId);
    expect(history).not.toMatch(/sha256|expected|declared|Commission/);
  });

  it('S5: retries a build while the approval is not committed, and a manifest while documents is down', async () => {
    let builds = 0;
    let issues = 0;
    const { mocks, calls } = activities({
      buildRelease: vi.fn(() => {
        builds += 1;
        if (builds < 3) return Promise.reject(new NcrNotApproved('not approved yet'));
        return Promise.resolve({ version: 1 });
      }),
      issueReleaseManifest: vi.fn(() => {
        issues += 1;
        if (issues < 2) return Promise.reject(new Error('The documents service is unreachable'));
        return Promise.resolve(MANIFEST);
      }),
    });

    await expect(run(mocks, `${openDataReleaseWorkflowId(INPUT)}:retries`)).resolves.toMatchObject({
      version: 1,
    });
    expect(builds).toBe(3);
    expect(issues).toBe(2);
    expect(calls).toEqual(['publish']);
  });

  it.each([
    [
      'the release does not reconcile with the NCR',
      'buildRelease' as const,
      new ReconciliationFailed(['national.initial.declared']),
      'ReconciliationFailed',
    ],
    [
      'documents refuses the manifest',
      'issueReleaseManifest' as const,
      new InternalApiRejected('documents', 400),
      'InternalApiRejected',
    ],
  ])('fails without retrying when %s, publishing nothing', async (_name, step, error, type) => {
    const failing = vi.fn(() => Promise.reject(error));
    const { mocks } = activities({ [step]: failing });

    const failure = await run(mocks, `${openDataReleaseWorkflowId(INPUT)}:${type}`).catch(
      (caught: unknown) => caught,
    );

    expect(failure).toBeInstanceOf(WorkflowFailedError);
    expect(JSON.stringify((failure as WorkflowFailedError).cause)).toContain(type);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });
});
