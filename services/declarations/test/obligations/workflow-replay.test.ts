import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  type RecordedHistory,
  recordHistory,
  replayHistories,
  WorkflowTestEnvironment,
} from '@adili/temporal/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ObligationStatus } from '../../src/obligations/engine.js';
import type { ObligationActivities } from '../../src/obligations/workflow/activities.js';
import type { CycleOpeningActivities } from '../../src/obligations/workflow/cycle-opening-activities.js';
import {
  cancelSignal,
  CYCLE_OPENING_PAGES_PER_RUN,
  type CycleOpeningPageRequest,
  filedSignal,
  type LoadedObligation,
  personLinkedSignal,
  stateQuery,
} from '../../src/obligations/workflow/contract.js';
import { cycleOpening, filingObligation } from '../../src/obligations/workflow/workflows.js';

/**
 * Replay tests (ADR-003): the histories under `workflow-histories/` were recorded from the
 * workflows as they shipped and must replay against the current code. A failure means a change
 * would break the workflows already running: guard it with `patched()` instead (then record the
 * new behaviour as another history, keeping the old one).
 *
 * Record new histories with `RECORD_WORKFLOW_HISTORIES=1 pnpm vitest run
 * test/obligations/workflow-replay.test.ts` (Temporal's time-skipping test server, mocked
 * activities). Recording overwrites the files of the scenarios below: commit only new ones.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/obligations/workflow/workflows.ts', import.meta.url),
);
const historiesDir = fileURLToPath(new URL('./workflow-histories/', import.meta.url));
const RECORD = process.env.RECORD_WORKFLOW_HISTORIES === '1';

describe.skipIf(RECORD)('workflow replay', () => {
  const historyFiles = () =>
    readdirSync(historiesDir)
      .filter((file) => file.endsWith('.json'))
      .sort();

  it('has histories of both workflows', () => {
    const histories = historyFiles();
    expect(histories.some((file) => file.startsWith('filing-obligation.'))).toBe(true);
    expect(histories.some((file) => file.startsWith('cycle-opening.'))).toBe(true);
  });

  it('replays every recorded history against the current workflow code', async () => {
    const recorded = historyFiles().map(
      (file) => JSON.parse(readFileSync(`${historiesDir}${file}`, 'utf8')) as RecordedHistory,
    );
    await expect(replayHistories(workflowsPath, recorded)).resolves.toBeUndefined();
  }, 120_000);
});

describe.runIf(RECORD)('record workflow histories', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    mkdirSync(historiesDir, { recursive: true });
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  const save = (name: string, history: RecordedHistory) => {
    writeFileSync(`${historiesDir}${name}.json`, `${JSON.stringify(history, null, 2)}\n`);
  };
  const nairobi = (date: string) => new Date(`${date}T00:00:00+03:00`);
  const runOf = (workflowId: string, runId?: string) =>
    env.env.client.workflow.getHandle(workflowId, runId);

  type Activities = { [K in keyof ObligationActivities]: ObligationActivities[K] };

  /** The obligation as the database would keep it; `failReminders` sends fail throughout. */
  function obligationActivities(
    row: LoadedObligation,
    options: { personId?: string | null; failReminders?: boolean } = {},
  ): Activities & { link: () => void } {
    let personId = options.personId ?? null;
    return {
      link: () => {
        personId = 'person-1';
      },
      loadObligation: () => Promise.resolve({ ...row }),
      setStatus: (_ref, status: ObligationStatus) => {
        if (row.status !== 'cancelled' && row.status !== 'filed') row.status = status;
        return Promise.resolve(row.status);
      },
      recordSkippedReminders: () => Promise.resolve(),
      sendReminder: () => {
        if (options.failReminders) return Promise.reject(new Error('notifications unreachable'));
        return Promise.resolve(personId === null ? 'skipped-not-onboarded' : 'sent');
      },
      sweepObligations: () => Promise.resolve({ started: 0, cancelled: 0 }),
    };
  }

  function obligation(
    id: string,
    type: LoadedObligation['type'],
    statementDate: string,
    dueDate: string,
    status: ObligationStatus,
  ): LoadedObligation {
    return {
      obligationId: id,
      tenant: 'psc',
      type,
      statementDate,
      dueDate,
      status,
      personLinked: false,
      reminderOffsetsDays: [30, 14, 7],
      recordedOffsets: [],
      jitterWindowMs: 6 * 60 * 60 * 1000,
    };
  }

  /** Plays a filing obligation, then saves its history. */
  async function playObligation(
    name: string,
    row: LoadedObligation,
    activities: Activities,
    body: (handle: ReturnType<typeof runOf>) => Promise<void>,
  ) {
    await env.run(
      filingObligation,
      {
        workflowsPath,
        activities,
        args: [{ obligationId: row.obligationId }],
        workflowId: row.obligationId,
      },
      async (handle) => {
        await vi.waitFor(async () => {
          expect((await handle.query(stateQuery)).status).not.toBeNull();
        });
        await body(runOf(handle.workflowId));
        await handle.result();
      },
    );
    save(name, await recordHistory(runOf(row.obligationId)));
  }

  it('filing obligation: a biennial due, reminded three times, overdue, then cancelled', async () => {
    await env.skipTime({ until: nairobi('2027-06-01') });
    const row = obligation(
      '0199a000-0000-7000-8000-0000000c0001',
      'biennial',
      '2027-11-01',
      '2027-12-31',
      'upcoming',
    );
    await playObligation(
      'filing-obligation.biennial-cancelled',
      row,
      obligationActivities(row, { personId: 'person-1' }),
      async (handle) => {
        await env.skipTime({ until: nairobi('2028-01-02') });
        await handle.signal(cancelSignal, 'superseded');
      },
    );
  }, 120_000);

  it('filing obligation: an initial reminded before onboarding, linked, overdue, then filed', async () => {
    await env.skipTime({ until: nairobi('2028-03-10') });
    const row = obligation(
      '0199a000-0000-7000-8000-0000000c0002',
      'initial',
      '2028-03-10',
      '2028-04-09',
      'due',
    );
    const activities = obligationActivities(row);
    await playObligation(
      'filing-obligation.initial-linked-filed',
      row,
      activities,
      async (handle) => {
        await env.skipTime({ until: nairobi('2028-03-20') });
        activities.link();
        await handle.signal(personLinkedSignal);
        await env.skipTime({ until: nairobi('2028-04-11') });
        await handle.signal(filedSignal);
      },
    );
  }, 120_000);

  it('filing obligation: created late (reminders missed), a reminder failing every attempt, cancelled', async () => {
    await env.skipTime({ until: nairobi('2029-03-01') });
    const row = obligation(
      '0199a000-0000-7000-8000-0000000c0003',
      'final',
      '2029-02-10',
      '2029-03-12',
      'due',
    );
    await playObligation(
      'filing-obligation.missed-and-failed',
      row,
      obligationActivities(row, { personId: 'person-1', failReminders: true }),
      async (handle) => {
        await env.skipTime({ until: nairobi('2029-03-14') });
        await handle.signal(cancelSignal, 'exited-before-statement-date');
      },
    );
  }, 120_000);

  it('filing obligation: already cancelled when its workflow starts', async () => {
    const row = obligation(
      '0199a000-0000-7000-8000-0000000c0004',
      'biennial',
      '2029-11-01',
      '2029-12-31',
      'cancelled',
    );
    await env.execute(filingObligation, {
      workflowsPath,
      activities: obligationActivities(row),
      args: [{ obligationId: row.obligationId }],
      workflowId: row.obligationId,
    });
    save('filing-obligation.already-cancelled', await recordHistory(runOf(row.obligationId)));
  });

  type OpeningActivities = { [K in keyof CycleOpeningActivities]: CycleOpeningActivities[K] };

  function openingActivities(due: number[], pages: number): OpeningActivities {
    const created = new Map<number, number>();
    return {
      cyclesToOpen: () => Promise.resolve([...due]),
      openCyclePage: ({ cycleYear, cursor }: CycleOpeningPageRequest) => {
        created.set(cycleYear, (created.get(cycleYear) ?? 0) + 3);
        const next = (cursor === null ? 0 : Number(cursor)) + 1;
        return Promise.resolve({ created: 3, nextCursor: next < pages ? String(next) : null });
      },
      recordCycleOpened: (_tenant: string, cycleYear: number) =>
        Promise.resolve({ cycleYear, count: created.get(cycleYear) ?? 0 }),
    };
  }

  it('cycle opening: two cycles due, two pages each', async () => {
    const workflowId = 'cycle-opening-replay-two-cycles';
    await env.execute(cycleOpening, {
      workflowsPath,
      activities: openingActivities([2027, 2029], 2),
      args: [{ tenant: 'psc' }],
      workflowId,
    });
    save('cycle-opening.two-cycles', await recordHistory(runOf(workflowId)));
  });

  it('cycle opening: nothing due', async () => {
    const workflowId = 'cycle-opening-replay-nothing-due';
    await env.execute(cycleOpening, {
      workflowsPath,
      activities: openingActivities([], 1),
      args: [{ tenant: 'psc' }],
      workflowId,
    });
    save('cycle-opening.nothing-due', await recordHistory(runOf(workflowId)));
  });

  it('cycle opening: continues as new after 100 pages, and the run that resumes', async () => {
    const workflowId = 'cycle-opening-replay-continue-as-new';
    await env.run(
      cycleOpening,
      {
        workflowsPath,
        activities: openingActivities([2027], CYCLE_OPENING_PAGES_PER_RUN + 5),
        args: [{ tenant: 'psc' }],
        workflowId,
      },
      async (handle) => {
        await handle.result();
        save(
          'cycle-opening.continued',
          await recordHistory(runOf(workflowId, handle.firstExecutionRunId)),
        );
        save('cycle-opening.resumed', await recordHistory(runOf(workflowId)));
      },
    );
  }, 120_000);
});
