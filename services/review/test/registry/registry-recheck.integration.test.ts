import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CaseDetail } from '../../src/cases/representation.js';
import { config } from '../../src/config.js';
import {
  outbox,
  registryChecks,
  reviewCases,
  reviewFlags,
  reviewTimeline,
} from '../../src/db/schema.js';
import { RegistryCheckActivities } from '../../src/registry/activities.js';
import {
  REGISTRY_SWEEP_WORKFLOW,
  type RegistryCheckRequest,
  type RegistryCheckResult,
  type RegistrySweepResult,
  registryRecheckWorkflowId,
  registrySweepScheduleId,
} from '../../src/registry/contract.js';
import { RegistryWorkflows } from '../../src/registry/registry-workflows.js';
import type { registryCheck, registrySweep } from '../../src/registry/workflows.js';
import { wanjikuDocument, wanjikuHousehold } from '../fixtures/households.js';
import { BARAKA, IMANI, PETER, type SeededPerson, WANJIKU } from '../fixtures/registries.js';
import { processed, processingInput } from '../support/cases.js';
import { temporalOf } from '../support/closures.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type StoredVersion, submittedVersion } from '../support/fake-declarations.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * Re-checks and the sweep of unavailable registries at the review service's seams (spec 07b S10,
 * S11): the re-check endpoint's authorisation and cooldown, the check it starts on Temporal, flags
 * a re-check no longer raises closed `superseded-by-recheck` (reviewed ones keeping their note),
 * and the hourly sweep picking up a case whose registry came back.
 */
describe('registry re-checks and the sweep', () => {
  let api: ReviewApi;
  let registry: RegistryCheckActivities;

  const assignee: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'], name: 'Asha' };
  const otherReviewer: Caller = { sub: 'reviewer-b', tenant: 'psc', roles: ['reviewer'] };
  const supervisor: Caller = { sub: 'supervisor-s', tenant: 'psc', roles: ['supervisor'] };
  const recheckPath = (caseId: string) => `/v1/review/cases/${caseId}/recheck`;

  const SOLD_VEHICLE = 'KDK 482M';
  const NEW_PARCEL = 'KAJIADO/KITENGELA/59821';

  beforeAll(async () => {
    api = await startReviewApi();
    registry = api.app.get(RegistryCheckActivities);
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
  });

  /** A seeded person's registry records, as the gateway would hold them, optionally trimmed. */
  function seed(
    person: SeededPerson,
    { without = [] as string[] }: { without?: string[] } = {},
  ): void {
    const { kra, ntsa, brs, ardhisasa } = person.results();
    api.gateway.givenRegistryPerson(person.nationalId, {
      kra: { taxpayers: kra.taxpayers },
      ntsa: { vehicles: ntsa.vehicles.filter((v) => !without.includes(v.registrationNumber)) },
      brs: { directorships: brs.directorships },
      ardhisasa: { parcels: ardhisasa.parcels.filter((p) => !without.includes(p.parcelNumber)) },
    });
  }

  function wanjikuVersion(): StoredVersion {
    const version = submittedVersion({
      tenant: 'psc',
      declarantName: 'Wanjiku Njoki Kamau',
      document: wanjikuDocument(wanjikuHousehold()),
    });
    api.declarations.given(version);
    api.directory.givenRosterRecord('psc', version.rosterRecordId, {
      personalNumber: 'KEMSA/2016/0311',
      nationalId: WANJIKU.nationalId,
      employerCode: 'KEMSA',
      reportingEntityId: null,
    });
    for (const person of [WANJIKU, PETER, IMANI, BARAKA]) seed(person);
    api.gateway.givenSuppliers('KEMSA', ['PVT-9XYZ2L4Q']);
    return version;
  }

  /** A case of Wanjiku Kamau's declaration, its registries checked once, as processing does. */
  async function checkedCase(): Promise<RegistryCheckRequest> {
    const version = wanjikuVersion();
    const caseId = await processed(api, version);
    const request = { ...processingInput(version), caseId };
    await check(request);
    return request;
  }

  async function check(request: RegistryCheckRequest) {
    const lookups = await registry.lookupRegistries({ check: request, previous: null });
    if (!lookups) throw new Error('stale');
    return registry.matchRegistries({ check: request, lookups });
  }

  const claim = async (caseId: string, caller = assignee) => {
    const response = await api.send('POST', `/v1/review/cases/${caseId}/claim`, caller);
    expect(response.statusCode).toBe(200);
  };

  /** The re-check the latest `registry-rechecked` entry started, run to its end. */
  async function recheckRun(caseId: string): Promise<RegistryCheckResult> {
    const [entry] = await api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewTimeline)
        .where(
          and(eq(reviewTimeline.caseId, caseId), eq(reviewTimeline.kind, 'registry-rechecked')),
        )
        .orderBy(desc(reviewTimeline.at))
        .limit(1),
    );
    if (!entry?.ref) throw new Error('no re-check');
    return temporalOf(api)
      .workflow.getHandle<typeof registryCheck>(registryRecheckWorkflowId(caseId, entry.ref))
      .result();
  }

  const caseRow = async (caseId: string) => {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.id, caseId)),
    );
    if (!row) throw new Error('no case');
    return row;
  };
  const registryFlags = (caseId: string) =>
    api.asPlatform(async (tx) =>
      (
        await tx
          .select()
          .from(reviewFlags)
          .where(eq(reviewFlags.caseId, caseId))
          .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id))
      ).filter((flag) => flag.ruleId !== 'no-previous-version'),
    );
  const flagOf = async (caseId: string, ruleId: string) => {
    const flag = (await registryFlags(caseId)).find((f) => f.ruleId === ruleId);
    if (!flag) throw new Error(`no ${ruleId} flag`);
    return flag;
  };
  const eventsOf = async (type: string) =>
    (await api.db.select().from(outbox).orderBy(asc(outbox.createdAt))).filter(
      (event) => event.eventType === type,
    );

  it('S11: the assignee re-checks: flags no longer raised are closed superseded-by-recheck, a reviewed one keeps its note', async () => {
    const request = await checkedCase();
    const { caseId } = request;
    await claim(caseId);
    const parcel = await flagOf(caseId, 'registry-parcel-undeclared');
    const reviewed = await api.send(
      'POST',
      `/v1/review/cases/${caseId}/flags/${parcel.id}/reviewed`,
      assignee,
      { note: 'Bought in 2025; title deed requested' },
    );
    expect(reviewed.statusCode).toBe(200);
    expect(await caseRow(caseId)).toMatchObject({ score: 17, openFlags: 3 });
    // The vehicle is sold and the parcel transferred: the registries no longer list them.
    seed(WANJIKU, { without: [SOLD_VEHICLE, NEW_PARCEL] });
    const lookupsBefore = api.gateway.lookups.length;

    const response = await api.send('POST', recheckPath(caseId), assignee);

    expect(response.statusCode).toBe(202);
    expect(await recheckRun(caseId)).toMatchObject({ outcome: 'checked', flags: 1 });

    const flags = await registryFlags(caseId);
    expect(flags.map((flag) => [flag.ruleId, flag.closedReason]).sort()).toEqual([
      ['directorship-employer-supplier', null],
      ['registry-parcel-undeclared', 'superseded-by-recheck'],
      ['registry-vehicle-undeclared', 'superseded-by-recheck'],
    ]);
    const closedParcel = flags.find((flag) => flag.id === parcel.id);
    expect(closedParcel?.reviewNote).toBe('Bought in 2025; title deed requested');
    expect(closedParcel?.reviewedBy).toBe('reviewer-a');
    // Closed flags count for neither the score nor the open flags.
    expect(await caseRow(caseId)).toMatchObject({ score: 7, openFlags: 2 });
    // The re-check looked everyone up again, for the case.
    const lookups = api.gateway.lookups.slice(lookupsBefore);
    expect(lookups).toHaveLength(17);
    expect(lookups.every((lookup) => lookup.context.caseRef === caseId)).toBe(true);

    const [rechecked] = await eventsOf('review.case.rechecked.v1');
    expect(rechecked?.envelope).toMatchObject({
      subject: caseId,
      tenant: 'psc',
      data: { caseId, versionId: request.versionId, by: 'reviewer-a' },
    });
    const checkedEvents = await eventsOf('review.registry.checked.v1');
    expect(checkedEvents.at(-1)?.envelope.data).toMatchObject({ flags: 1, superseded: 2 });

    const detail = await api.get(`/v1/review/cases/${caseId}`, assignee);
    expect(detail.statusCode).toBe(200);
    const body = detail.json<CaseDetail>();
    expect(contractErrors(okResponse('/v1/review/cases/{caseId}', 'get'), body)).toEqual([]);
    expect(body.flags.find((flag) => flag.id === parcel.id)).toMatchObject({
      closedReason: 'superseded-by-recheck',
      reviewed: { note: 'Bought in 2025; title deed requested' },
    });
    expect(body.timeline.map((entry) => entry.summary)).toEqual(
      expect.arrayContaining([
        'Registry re-check requested',
        'Registries checked: 1 registry indicator; 2 no longer raised',
      ]),
    );
  });

  it('S11: another reviewer is refused 403; a supervisor may; within ten minutes 429, after that again', async () => {
    const { caseId } = await checkedCase();
    await claim(caseId);
    api.clock.set('2027-12-11T09:00:00.000Z');

    const refused = await api.send('POST', recheckPath(caseId), otherReviewer);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ type: 'not-the-assignee' });

    expect((await api.send('POST', recheckPath(caseId), supervisor)).statusCode).toBe(202);
    await recheckRun(caseId);

    api.clock.set('2027-12-11T09:09:00.000Z');
    const soon = await api.send('POST', recheckPath(caseId), assignee);
    expect(soon.statusCode).toBe(429);
    expect(soon.json()).toMatchObject({ type: 'recheck-cooldown', retryAfterSeconds: 60 });

    api.clock.set('2027-12-11T09:10:00.000Z');
    expect((await api.send('POST', recheckPath(caseId), assignee)).statusCode).toBe(202);
    await recheckRun(caseId);

    // The refused attempts recorded nothing.
    expect(await eventsOf('review.case.rechecked.v1')).toHaveLength(2);
  });

  it('an unassigned case is refused to reviewers; another Commission sees nothing; a determined case is 409', async () => {
    const { caseId } = await checkedCase();

    expect((await api.send('POST', recheckPath(caseId), assignee)).statusCode).toBe(403);
    const elsewhere = { sub: 'reviewer-t', tenant: 'tsc', roles: ['reviewer'] };
    expect((await api.send('POST', recheckPath(caseId), elsewhere)).statusCode).toBe(404);
    expect((await api.send('POST', recheckPath(randomUUID()), supervisor)).statusCode).toBe(404);

    await api.asPlatform((tx) =>
      tx.update(reviewCases).set({ status: 'determined' }).where(eq(reviewCases.id, caseId)),
    );
    const closed = await api.send('POST', recheckPath(caseId), supervisor);
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({ type: 'case-closed' });
    expect(await eventsOf('review.case.rechecked.v1')).toEqual([]);
  });

  it('a registry still unavailable leaves its flags open; one raised again after being superseded opens again', async () => {
    const request = await checkedCase();
    const vehicle = await flagOf(request.caseId, 'registry-vehicle-undeclared');

    api.gateway.failRegistry('ntsa', { kind: 'unavailable', reason: 'timeout' });
    seed(WANJIKU, { without: [SOLD_VEHICLE] });
    await check(request);

    expect((await flagOf(request.caseId, 'registry-vehicle-undeclared')).closedReason).toBeNull();
    expect(await caseRow(request.caseId)).toMatchObject({ score: 17, registryUnavailable: true });

    api.gateway.failRegistry('ntsa', { kind: 'unavailable', reason: 'timeout' }, 0);
    await check(request);
    expect((await flagOf(request.caseId, 'registry-vehicle-undeclared')).closedReason).toBe(
      'superseded-by-recheck',
    );

    seed(WANJIKU);
    await check(request);
    const reopened = await flagOf(request.caseId, 'registry-vehicle-undeclared');
    expect(reopened).toMatchObject({ id: vehicle.id, closedReason: null });
    expect(await caseRow(request.caseId)).toMatchObject({ score: 17, openFlags: 4 });
  });

  describe('S10: the sweep', () => {
    it('re-checks a case whose registry came back: statuses updated, new flags, review.registry.checked.v1', async () => {
      api.gateway.failRegistry('ardhisasa', { kind: 'unavailable', reason: 'timeout' });
      const request = await checkedCase();
      expect(await caseRow(request.caseId)).toMatchObject({ registryUnavailable: true });
      expect((await registryFlags(request.caseId)).map((flag) => flag.ruleId)).not.toContain(
        'registry-parcel-undeclared',
      );
      // ArdhiSasa is back.
      api.gateway.failRegistry('ardhisasa', { kind: 'unavailable', reason: 'timeout' }, 0);

      const result = await temporalOf(api).workflow.execute<typeof registrySweep>(
        REGISTRY_SWEEP_WORKFLOW,
        { taskQueue: config.TEMPORAL_TASK_QUEUE, workflowId: `registry-sweep-${randomUUID()}` },
      );

      expect(result).toEqual<RegistrySweepResult>({ checked: 1, stale: 0, failed: 0 });
      expect(await caseRow(request.caseId)).toMatchObject({
        registryUnavailable: false,
        score: 17,
      });
      const statuses = await api.asPlatform((tx) =>
        tx
          .select({ status: registryChecks.status })
          .from(registryChecks)
          .where(
            and(eq(registryChecks.caseId, request.caseId), eq(registryChecks.system, 'ardhisasa')),
          ),
      );
      expect(statuses.map((row) => row.status).sort()).toEqual([
        'matched',
        'matched',
        'matched',
        'mismatched',
      ]);
      expect((await registryFlags(request.caseId)).map((flag) => flag.ruleId)).toContain(
        'registry-parcel-undeclared',
      );
      const checked = await eventsOf('review.registry.checked.v1');
      expect(checked).toHaveLength(2);
      expect(checked[1]?.envelope.data).toMatchObject({
        caseId: request.caseId,
        systems: { ardhisasa: 'mismatched' },
      });
    });

    it('takes open cases with a registry unavailable, oldest check first, at most the batch', async () => {
      api.gateway.failRegistry('kra', { kind: 'unavailable', reason: 'timeout' });
      const older = await checkedCase();
      const newer = await checkedCase();
      const determined = await checkedCase();
      api.gateway.failRegistry('kra', { kind: 'unavailable', reason: 'timeout' }, 0);
      const answered = await checkedCase();
      await api.asPlatform(async (tx) => {
        await tx
          .update(registryChecks)
          .set({ checkedAt: new Date('2020-01-01T08:00:00.000Z') })
          .where(eq(registryChecks.caseId, older.caseId));
        await tx
          .update(reviewCases)
          .set({ status: 'determined' })
          .where(eq(reviewCases.id, determined.caseId));
      });

      const candidates = await registry.registrySweepCandidates({ limit: 10 });

      expect(candidates).toEqual([older, newer]);
      expect(candidates.map((c) => c.caseId)).not.toContain(answered.caseId);
      expect(await registry.registrySweepCandidates({ limit: 1 })).toEqual([older]);
    });

    it('keeps an hourly Temporal schedule that starts the sweep', async () => {
      const scheduleId = await api.app.get(RegistryWorkflows).ensureSchedule('0 * * * *');
      const handle = temporalOf(api).schedule.getHandle(scheduleId);
      try {
        expect(scheduleId).toBe(registrySweepScheduleId(config.TEMPORAL_TASK_QUEUE));
        const described = await handle.describe();
        expect(described.action).toMatchObject({
          type: 'startWorkflow',
          workflowType: REGISTRY_SWEEP_WORKFLOW,
          taskQueue: config.TEMPORAL_TASK_QUEUE,
        });
        expect(described.spec.timezone).toBe('Africa/Nairobi');
        expect(described.spec.calendars?.[0]?.minute).toEqual([{ start: 0, end: 0, step: 1 }]);
      } finally {
        await handle.delete();
      }
    });
  });
});
