import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  type RecordedHistory,
  recordHistory,
  replayHistories,
  WorkflowTestEnvironment,
} from '@adili/temporal/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  RegistryCheckRequest,
  RegistryCheckResult,
  RegistryLookups,
  SweepCheck,
} from '../../src/registry/contract.js';
import { registrySweep } from '../../src/registry/workflows.js';

/**
 * Replay tests (ADR-003): the histories under `workflow-histories/` were recorded from the
 * review workflows as they shipped and must replay against the current code. A failure means a
 * change would break the workflows already running: guard it with `patched()` instead (then
 * record the new behaviour as another history, keeping the old one).
 *
 * `registry-sweep.registry-check-child` was recorded before #603, when the sweep's child was
 * `registryCheck`; `registry-sweep.registry-recheck-child` after, with `registryRecheck`.
 *
 * Record new histories with `RECORD_WORKFLOW_HISTORIES=1 pnpm vitest run
 * test/registry/workflow-replay.test.ts` (Temporal's time-skipping test server, mocked
 * activities). Recording overwrites the files of the scenarios below: commit only new ones.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));
const historiesDir = fileURLToPath(new URL('./workflow-histories/', import.meta.url));
const RECORD = process.env.RECORD_WORKFLOW_HISTORIES === '1';
/** The scenario a recording run saves, e.g. `registry-recheck-child`. */
const RECORD_AS = process.env.RECORD_WORKFLOW_HISTORY_AS ?? 'registry-recheck-child';

describe.skipIf(RECORD)('review workflow replay', () => {
  const historyFiles = () =>
    readdirSync(historiesDir)
      .filter((file) => file.endsWith('.json'))
      .sort();

  it('has the sweep from before and after #603', () => {
    expect(historyFiles()).toEqual(
      expect.arrayContaining([
        'registry-sweep.registry-check-child.json',
        'registry-sweep.registry-recheck-child.json',
      ]),
    );
  });

  it('replays every recorded history against the current workflow code', async () => {
    const recorded = historyFiles().map(
      (file) => JSON.parse(readFileSync(`${historiesDir}${file}`, 'utf8')) as RecordedHistory,
    );
    await expect(replayHistories(workflowsPath, recorded)).resolves.toBeUndefined();
  }, 120_000);
});

describe.runIf(RECORD)('record review workflow histories', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    mkdirSync(historiesDir, { recursive: true });
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  const request: RegistryCheckRequest = {
    tenant: 'psc',
    caseId: '0199b000-0000-7000-8000-0000000000c1',
    declarationId: '0199b000-0000-7000-8000-000000000001',
    versionId: '0199b000-0000-7000-8000-000000000002',
    version: 1,
  };
  const answered: RegistryLookups = {
    sequence: 2,
    persons: {
      officer: {
        ardhisasa: {
          outcome: 'found',
          reason: null,
          resultId: 'r-ardhisasa',
          checkedAt: '2027-12-10T10:00:00.000Z',
        },
      },
    },
    suppliers: {},
  };
  // A status changed (ArdhiSasa came back), so after #603 the sweep refreshes the copilot.
  const checked: RegistryCheckResult = {
    outcome: 'checked',
    flags: 1,
    statuses: [{ personKey: 'officer', system: 'ardhisasa', status: 'mismatched', reason: null }],
    checkedAt: '2027-12-10T10:00:01.000Z',
    changed: true,
  };

  it('records a sweep of one case whose registry came back', async () => {
    await env.run(
      registrySweep,
      {
        workflowsPath,
        activities: {
          planRegistrySweep: () => Promise.resolve<SweepCheck[]>([{ request, startAfterMs: 0 }]),
          lookupRegistries: () => Promise.resolve(answered),
          matchAndStoreRegistries: () => Promise.resolve(checked),
          requestCopilot: () => Promise.resolve(),
          settleCopilot: () => Promise.resolve(),
          copilotUnavailable: () => Promise.resolve(),
        },
        args: [],
      },
      async (handle) => {
        await handle.result();
        const history = await recordHistory(handle);
        writeFileSync(
          `${historiesDir}registry-sweep.${RECORD_AS}.json`,
          `${JSON.stringify(history, null, 2)}\n`,
        );
      },
    );
  }, 120_000);
});
