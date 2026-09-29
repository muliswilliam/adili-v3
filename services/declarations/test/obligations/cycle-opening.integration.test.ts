import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { withTenant } from '@adili/data-access';
import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cycleCalendar, cycleOpenings, filingObligations, outbox } from '../../src/db/schema.js';
import type { Transaction } from '../../src/obligations/apply-page.js';
import { ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import { CycleOpeningActivities } from '../../src/obligations/workflow/cycle-opening-activities.js';
import type { CycleOpeningPageRequest } from '../../src/obligations/workflow/contract.js';
import { cycleOpening } from '../../src/obligations/workflow/workflows.js';
import {
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * S13: cycle opening. `CycleOpeningWorkflow` runs in Temporal's time-skipping environment with the
 * service's real activities against real Postgres (fake directory, recorded obligation workflows).
 *
 * The 2027 cycle opens on 2027-07-04 (120 days before 1 November). PSC imported its roster on
 * 2027-06-01, before that: three active officers and one who left on 2027-05-15.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/obligations/workflow/workflows.ts', import.meta.url),
);
const BEFORE_OPENING = '2027-06-01';
const OPENING_DAY = '2027-07-04';

let api: DeclarationsApi;
let env: WorkflowTestEnvironment;
let pageCalls: CycleOpeningPageRequest[];

beforeAll(async () => {
  api = await startDeclarationsApi();
  env = await WorkflowTestEnvironment.create();
}, 60_000);

afterAll(async () => {
  await env.teardown();
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  pageCalls = [];
  api.clock.setToday(BEFORE_OPENING);
  api.directory.givenCommission('psc', 'Public Service Commission');
  api.directory.givenCommission('tsc', 'Teachers Service Commission');
});

/** Fires the tenant's cycle opening as its schedule would, with the service's activities. */
function open(tenant: string) {
  const activities = api.app.get(CycleOpeningActivities);
  return env.execute(cycleOpening, {
    workflowsPath,
    activities: {
      cyclesToOpen: (slug: string) => activities.cyclesToOpen(slug),
      openCyclePage: (request: CycleOpeningPageRequest) => {
        pageCalls.push(request);
        return activities.openCyclePage(request);
      },
      recordCycleOpened: (slug: string, cycle: { cycleYear: number; count: number }) =>
        activities.recordCycleOpened(slug, cycle),
    },
    args: [{ tenant }],
  });
}

async function importRecords(tenant: string, records: ReturnType<typeof rosterRecord>[]) {
  const importId = randomUUID();
  api.directory.givenImport(importId, records);
  await api.consumers.importCompleted(
    directoryEvent(ROSTER_IMPORT_COMPLETED, tenant, { importId, channel: 'file' }),
  );
}

function asPlatform<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, work);
}

async function biennials(tenant = 'psc') {
  return asPlatform((tx) =>
    tx
      .select({
        id: filingObligations.id,
        rosterRecordId: filingObligations.rosterRecordId,
        cycleKey: filingObligations.cycleKey,
        statementDate: filingObligations.statementDate,
        dueDate: filingObligations.dueDate,
        status: filingObligations.status,
      })
      .from(filingObligations)
      .where(and(eq(filingObligations.tenant, tenant), eq(filingObligations.type, 'biennial')))
      .orderBy(asc(filingObligations.rosterRecordId)),
  );
}

async function openedEvents() {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, 'obligation.cycle-opened.v1'))
    .orderBy(asc(outbox.id));
  return rows.map(({ envelope }) => envelope);
}

function pscRoster() {
  const active = [0, 1, 2].map(() => rosterRecord('psc'));
  const exited = rosterRecord('psc', { state: 'exited', exitDate: '2027-05-15' });
  return { active, exited };
}

describe('S13 cycle opening', () => {
  it('creates the cycle’s biennial for each active officer and announces the count', async () => {
    const { active, exited } = pscRoster();
    await importRecords('psc', [...active, exited]);
    expect(await biennials()).toEqual([]);
    api.workflows.reset();

    api.clock.setToday(OPENING_DAY);
    const opened = await open('psc');

    expect(opened).toEqual([{ cycleYear: 2027, count: 3 }]);
    const created = await biennials();
    expect(created.map((o) => o.rosterRecordId)).toEqual(active.map((record) => record.id).sort());
    expect(created.every((o) => o.rosterRecordId !== exited.id)).toBe(true);
    for (const obligation of created) {
      expect(obligation).toMatchObject({
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'upcoming',
      });
    }
    // Their workflows are started after the page commits.
    expect(api.workflows.created().sort()).toEqual(created.map((o) => o.id).sort());
    expect(await openedEvents()).toEqual([
      expect.objectContaining({
        type: 'obligation.cycle-opened.v1',
        tenant: 'psc',
        subject: 'biennial:2027',
        data: { cycleYear: 2027, count: 3 },
      }),
    ]);
    const [record] = await api.asPlatform((tx) => tx.select().from(cycleOpenings));
    expect(record).toMatchObject({ tenant: 'psc', cycleYear: 2027, obligationsCreated: 3 });
  });

  it('creates nothing new when it fires again', async () => {
    const { active, exited } = pscRoster();
    await importRecords('psc', [...active, exited]);
    api.clock.setToday(OPENING_DAY);
    await open('psc');
    api.workflows.reset();
    pageCalls = [];

    const opened = await open('psc');

    expect(opened).toEqual([]);
    expect(pageCalls).toEqual([]);
    expect(await biennials()).toHaveLength(3);
    expect(await openedEvents()).toHaveLength(1);
    expect(api.workflows.created()).toEqual([]);
  });

  it('opens nothing before the opening date', async () => {
    await importRecords('psc', pscRoster().active);
    api.clock.setToday('2027-07-03');

    expect(await open('psc')).toEqual([]);
    expect(await biennials()).toEqual([]);
    expect(await openedEvents()).toEqual([]);
  });

  it('gives an officer ingested after the opening the biennial on ingest', async () => {
    await importRecords('psc', pscRoster().active);
    api.clock.setToday(OPENING_DAY);
    await open('psc');

    api.clock.setToday('2027-08-01');
    const late = rosterRecord('psc', { appointmentDate: '2020-02-03' });
    await importRecords('psc', [late]);

    const lateBiennials = (await biennials()).filter((o) => o.rosterRecordId === late.id);
    expect(lateBiennials).toMatchObject([{ cycleKey: 'biennial:2027', status: 'upcoming' }]);
  });

  it('pages through the active officers 1,000 at a time', async () => {
    await importRecords(
      'psc',
      Array.from({ length: 2_500 }, () => rosterRecord('psc')),
    );
    api.clock.setToday(OPENING_DAY);

    const opened = await open('psc');

    expect(opened).toEqual([{ cycleYear: 2027, count: 2_500 }]);
    expect(pageCalls).toHaveLength(3);
    expect(pageCalls[0]?.cursor).toBeNull();
    expect(await biennials()).toHaveLength(2_500);
    expect(api.workflows.created()).toHaveLength(2_500);
  }, 60_000);

  it('opens one Commission’s cycle only', async () => {
    await importRecords('psc', pscRoster().active);
    await importRecords('tsc', [rosterRecord('tsc')]);
    api.clock.setToday(OPENING_DAY);

    await open('psc');

    expect(await biennials('psc')).toHaveLength(3);
    expect(await biennials('tsc')).toEqual([]);
  });

  it('opens a cycle the calendar opens early (the demo) on its next firing', async () => {
    await importRecords('psc', pscRoster().active);
    await api.db
      .update(cycleCalendar)
      .set({ openingLeadDays: 200 })
      .where(eq(cycleCalendar.cycleYear, 2027));

    expect(await open('psc')).toEqual([{ cycleYear: 2027, count: 3 }]);
  });

  it('opens nothing for a Commission it has no policy for (no roster yet)', async () => {
    api.clock.setToday(OPENING_DAY);
    expect(await open('kra')).toEqual([]);
  });

  it('keeps the opening schedule of each Commission whose roster it ingests', async () => {
    await importRecords('psc', pscRoster().active);
    await importRecords('tsc', [rosterRecord('tsc')]);

    expect(api.cycleSchedules.ensured).toEqual(['psc', 'tsc']);
  });
});
