import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaseDetail } from '../../src/cases/representation.js';
import { config } from '../../src/config.js';
import {
  outbox,
  registryChecks,
  reviewCases,
  reviewFlags,
  reviewTimeline,
} from '../../src/db/schema.js';
import { registryStatusesOf } from '../../src/copilot/copilot-inputs.js';
import { reviewCopilots } from '../../src/copilot/schema.js';
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
import type { RegistryView } from '../../src/registry/representation.js';
import type { registryRecheck, registrySweep } from '../../src/registry/workflows.js';
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
    return registry.matchAndStoreRegistries({ check: request, lookups });
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
      .workflow.getHandle<typeof registryRecheck>(registryRecheckWorkflowId(caseId, entry.ref))
      .result();
  }

  const copilotOf = async (caseId: string) => {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(reviewCopilots).where(eq(reviewCopilots.caseId, caseId)),
    );
    return row;
  };
  /** When the case's registries were last checked: the time their statuses were stored. */
  const lastCheckedAt = async (caseId: string) => {
    const rows = await api.asPlatform((tx) =>
      tx.select().from(registryChecks).where(eq(registryChecks.caseId, caseId)),
    );
    return new Date(Math.max(...rows.map((row) => row.checkedAt.getTime()))).toISOString();
  };
  const lastSummaryInput = () =>
    api.ai.calls.filter((call) => call.task === 'summarize-declaration').at(-1)?.request.input as
      { registryStatuses: { system: string; status: string }[] } | undefined;

  /** The AI label on a fake job's output. */
  const aiLabel = (task: string) => ({
    aiAssisted: true,
    task,
    promptVersion: 1,
    provider: 'replay',
    model: 'claude-opus-5-5',
    generatedAt: '2028-01-20T08:05:00.000Z',
    disclaimer: 'Indicators, not findings. A named officer decides.',
  });
  /** Ends the copilot's requested jobs as the gateway would and waits for it to be ready. */
  const copilotReady = async (caseId: string) => {
    const row = await copilotOf(caseId);
    if (!row?.requestedSummaryJobId) throw new Error('no summarize job');
    await api.aiJobs.completed(
      api.ai.succeed(row.requestedSummaryJobId, {
        label: aiLabel('summarize-declaration'),
        overview: 'Overview before the re-check.',
        changesSincePrevious: [],
        sections: [],
        worthAttention: [],
      }),
    );
    if (row.requestedExplanationsJobId) {
      const flags = await api.asPlatform((tx) =>
        tx.select({ id: reviewFlags.id }).from(reviewFlags).where(eq(reviewFlags.caseId, caseId)),
      );
      await api.aiJobs.completed(
        api.ai.succeed(row.requestedExplanationsJobId, {
          label: aiLabel('explain-flags'),
          explanations: flags.map((flag) => ({
            flagId: flag.id,
            meaning: 'What the flag means.',
            whatToCheck: ['Check the registry record.'],
            typicalResolution: 'A document explains it.',
            refs: [],
          })),
        }),
      );
    }
    return vi.waitFor(
      async () => {
        const ready = await copilotOf(caseId);
        if (ready?.status !== 'ready') throw new Error(`copilot is ${String(ready?.status)}`);
        return ready;
      },
      { timeout: 45_000, interval: 250 },
    );
  };

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

  it("#603 S11: a re-check marks the copilot stale and asks anew with the case's registry statuses and the check's time", async () => {
    const request = await checkedCase();
    const { caseId } = request;
    await api.copilot.requestCopilot({ tenant: 'psc', caseId, trigger: 'case-created' });
    const before = await copilotReady(caseId);
    await claim(caseId);
    seed(WANJIKU, { without: [SOLD_VEHICLE] });

    expect((await api.send('POST', recheckPath(caseId), assignee)).statusCode).toBe(202);
    expect(await recheckRun(caseId)).toMatchObject({ outcome: 'checked' });

    const after = await copilotOf(caseId);
    expect(after).toMatchObject({ status: 'stale', attempt: before.attempt + 1 });
    expect(after?.requestedSummaryJobId).not.toBe(before.requestedSummaryJobId);
    expect(after?.registryCheckedAt?.toISOString()).toBe(await lastCheckedAt(caseId));
    // The summary is asked on exactly the statuses the re-check stored.
    const stored = await api.asPlatform((tx) =>
      tx.select().from(registryChecks).where(eq(registryChecks.caseId, caseId)),
    );
    expect(lastSummaryInput()?.registryStatuses).toEqual(registryStatusesOf(stored));
    expect(lastSummaryInput()?.registryStatuses.some((s) => s.system.endsWith(' · spouse'))).toBe(
      true,
    );
  });

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

  it("gives the latest check's time to poll during a re-check, without an audited read", async () => {
    const version = wanjikuVersion();
    const caseId = await processed(api, version);
    const statusPath = `/v1/review/cases/${caseId}/registry/status`;
    const status = async (caller: Caller = assignee) => {
      const response = await api.get(statusPath, caller);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<{ checkedAt: string | null }>();
      expect(
        contractErrors(okResponse('/v1/review/cases/{caseId}/registry/status', 'get'), body),
      ).toEqual([]);
      return body.checkedAt;
    };
    await api.asPlatform((tx) =>
      tx.delete(registryChecks).where(eq(registryChecks.caseId, caseId)),
    );
    expect(await status()).toBeNull();

    await check({ ...processingInput(version), caseId });
    await claim(caseId);
    const first = await status();
    expect(first).not.toBeNull();
    expect(
      (await api.get(`/v1/review/cases/${caseId}/registry`, assignee)).json<RegistryView>(),
    ).toMatchObject({ checkedAt: first });
    const auditedBefore = (await eventsOf('audit.read.v1')).length;

    expect((await api.send('POST', recheckPath(caseId), assignee)).statusCode).toBe(202);
    await recheckRun(caseId);
    const after = await status();
    expect(Date.parse(after ?? '')).toBeGreaterThan(Date.parse(first ?? ''));
    expect(await status(supervisor)).toBe(after);
    // Polled three times, audited never.
    expect(await eventsOf('audit.read.v1')).toHaveLength(auditedBefore);
    expect(
      (await api.get(statusPath, { sub: 'reviewer-x', tenant: 'tsc', roles: ['reviewer'] }))
        .statusCode,
    ).toBe(404);
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

  it('the case detail says when the next re-check is accepted: null before the first, ten minutes after the last', async () => {
    const { caseId } = await checkedCase();
    await claim(caseId);
    const availableAt = async () => {
      const response = await api.get(`/v1/review/cases/${caseId}`, assignee);
      expect(response.statusCode, response.body).toBe(200);
      expect(
        contractErrors(okResponse('/v1/review/cases/{caseId}', 'get'), response.json()),
      ).toEqual([]);
      return response.json<CaseDetail>().registry.recheckAvailableAt;
    };
    expect(await availableAt()).toBeNull();

    api.clock.set('2027-12-11T09:00:00.000Z');
    expect((await api.send('POST', recheckPath(caseId), assignee)).statusCode).toBe(202);
    await recheckRun(caseId);
    expect(await availableAt()).toBe('2027-12-11T09:10:00.000Z');

    api.clock.set('2027-12-11T09:25:00.000Z');
    expect((await api.send('POST', recheckPath(caseId), supervisor)).statusCode).toBe(202);
    await recheckRun(caseId);
    expect(await availableAt()).toBe('2027-12-11T09:35:00.000Z');
  });

  it('accepts an Idempotency-Key: a retry with it replays the 202 instead of meeting the cooldown (ADR-013 §7.5)', async () => {
    const { caseId } = await checkedCase();
    await claim(caseId);
    const key = { 'idempotency-key': randomUUID() };

    const first = await api.send('POST', recheckPath(caseId), assignee, undefined, key);
    expect(first.statusCode).toBe(202);
    await recheckRun(caseId);
    const retry = await api.send('POST', recheckPath(caseId), assignee, undefined, key);

    expect(retry.statusCode).toBe(202);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await eventsOf('review.case.rechecked.v1')).toHaveLength(1);
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

  it('of two checks of a case that overlap, the one that started later is kept, whichever ends last', async () => {
    const request = await checkedCase();
    // A slow check (the sweep's, say) starts while NTSA still lists the sold vehicle...
    const slow = await registry.lookupRegistries({ check: request, previous: null });
    if (!slow) throw new Error('stale');
    // ...then a re-check starts after the sale and is stored first.
    seed(WANJIKU, { without: [SOLD_VEHICLE] });
    await check(request);
    expect((await flagOf(request.caseId, 'registry-vehicle-undeclared')).closedReason).toBe(
      'superseded-by-recheck',
    );

    const late = await registry.matchAndStoreRegistries({ check: request, lookups: slow });

    expect(late).toEqual({ outcome: 'stale' });
    expect((await flagOf(request.caseId, 'registry-vehicle-undeclared')).closedReason).toBe(
      'superseded-by-recheck',
    );
    expect(await eventsOf('review.registry.checked.v1')).toHaveLength(2);
  });

  it("an amendment resets the registry statuses; the tab never pairs another version's records with the document", async () => {
    api.gateway.failRegistry('ardhisasa', { kind: 'unavailable', reason: 'timeout' });
    const request = await checkedCase();
    expect(await caseRow(request.caseId)).toMatchObject({ registryUnavailable: true });
    const [first] = await api.asPlatform((tx) =>
      tx.select().from(registryChecks).where(eq(registryChecks.caseId, request.caseId)),
    );
    if (!first) throw new Error('not checked');

    // Version 2 is processed: the case moves to it, its registries not checked yet.
    const amended = submittedVersion({
      tenant: 'psc',
      declarationId: request.declarationId,
      personId: (await caseRow(request.caseId)).personId,
      declarantName: 'Wanjiku Njoki Kamau',
      version: 2,
      document: wanjikuDocument(wanjikuHousehold()),
    });
    api.declarations.given(amended);
    api.directory.givenRosterRecord('psc', amended.rosterRecordId, {
      personalNumber: 'KEMSA/2016/0311',
      nationalId: WANJIKU.nationalId,
      employerCode: 'KEMSA',
      reportingEntityId: null,
    });
    expect(await processed(api, amended)).toBe(request.caseId);

    expect(await caseRow(request.caseId)).toMatchObject({
      currentVersionId: amended.versionId,
      registryUnavailable: false,
    });
    const detail = (
      await api.get(`/v1/review/cases/${request.caseId}`, supervisor)
    ).json<CaseDetail>();
    expect(detail.registry).toEqual({ checkedAt: null, checks: [], recheckAvailableAt: null });

    // Even a status of version 1 left behind is not shown against version 2's document.
    await api.asPlatform((tx) => tx.insert(registryChecks).values({ ...first, id: randomUUID() }));
    const reads = api.gateway.storedReads.length;
    const view = (
      await api.get(`/v1/review/cases/${request.caseId}/registry`, supervisor)
    ).json<RegistryView>();
    expect(new Set(view.persons.flatMap((p) => p.systems.map((s) => s.status)))).toEqual(
      new Set(['not-checked']),
    );
    expect(api.gateway.storedReads.slice(reads)).toEqual([]);
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
      // ArdhiSasa's answer changed the statuses: the copilot asks anew with them (#603).
      expect((await copilotOf(request.caseId))?.registryCheckedAt?.toISOString()).toBe(
        await lastCheckedAt(request.caseId),
      );
      expect(lastSummaryInput()?.registryStatuses).toContainEqual({
        system: 'ardhisasa',
        status: 'mismatched',
      });
      const checked = await eventsOf('review.registry.checked.v1');
      expect(checked).toHaveLength(2);
      expect(checked[1]?.envelope.data).toMatchObject({
        caseId: request.caseId,
        systems: { ardhisasa: 'mismatched' },
      });
    });

    it('plans open cases with a registry unavailable, oldest check first, paced under the rate limits', async () => {
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

      // KRA at one call a minute: the sweep takes half, and each case re-checks four people's KRA,
      // two calls each (M4: the PINs, then the compliance).
      api.gateway.givenRateLimits({ kra: 1 });

      const plan = await registry.planRegistrySweep();

      expect(plan).toEqual([
        { request: older, startAfterMs: 0 },
        { request: newer, startAfterMs: 16 * 60_000 },
      ]);
      expect(plan.map((c) => c.request.caseId)).not.toContain(answered.caseId);
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
