import { and, asc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaseDetail, CasePage } from '../../src/cases/representation.js';
import {
  outbox,
  registryChecks,
  reviewCases,
  reviewFlags,
  reviewTimeline,
} from '../../src/db/schema.js';
import { processingWorkflowId } from '../../src/processing/contract.js';
import { RegistryCheckActivities } from '../../src/registry/activities.js';
import type { RegistryCheckRequest, RegistryLookups } from '../../src/registry/contract.js';
import type { RegistryView } from '../../src/registry/representation.js';
import {
  BARAKA_KEY,
  IMANI_KEY,
  SPOUSE,
  wanjikuDocument,
  wanjikuHousehold,
} from '../fixtures/households.js';
import { BARAKA, IMANI, PETER, type SeededPerson, WANJIKU } from '../fixtures/registries.js';
import { processed, processingInput } from '../support/cases.js';
import { temporalOf } from '../support/closures.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type StoredVersion, submittedVersion } from '../support/fake-declarations.js';
import {
  type Caller,
  type ReviewApi,
  startReviewApi,
  submittedEvent,
} from '../support/review-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * Registry cross-checks at the review service's seams (spec 07b, S4-S9, S12): the processing
 * workflow looks up Wanjiku Kamau's household through the fake integration-gateway (the seed's
 * records), matches them against her declaration and stores flags and statuses on the case; the
 * Registry tab pulls the records back by result id; the queue filters on unavailable registries.
 */
describe('registry checks', () => {
  let api: ReviewApi;
  let registry: RegistryCheckActivities;

  const reviewer: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'], name: 'Asha' };
  const registryPath = (caseId: string) => `/v1/review/cases/${caseId}/registry`;

  beforeAll(async () => {
    api = await startReviewApi();
    registry = api.app.get(RegistryCheckActivities);
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
  });

  /** The registries' records of a seeded person, as the gateway would hold them. */
  function seed(person: SeededPerson): void {
    const { kra, ntsa, brs, ardhisasa } = person.results();
    api.gateway.givenRegistryPerson(person.nationalId, {
      kra: { taxpayers: kra.taxpayers },
      ntsa: { vehicles: ntsa.vehicles },
      brs: { directorships: brs.directorships },
      ardhisasa: { parcels: ardhisasa.parcels },
    });
  }

  /**
   * Wanjiku Kamau's demo declaration, her roster record (national ID, employer KEMSA) in the
   * directory, the seed's registry records for her household and KEMSA's supplier list.
   */
  function wanjikuVersion(ids: { baraka?: string } = {}): StoredVersion {
    const version = submittedVersion({
      tenant: 'psc',
      declarantName: 'Wanjiku Njoki Kamau',
      document: wanjikuDocument(wanjikuHousehold(), ids),
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

  /** The case of a version, created by the processing workflow's steps, without its check. */
  async function caseOf(version: StoredVersion): Promise<RegistryCheckRequest> {
    const caseId = await processed(api, version);
    return { ...processingInput(version), caseId };
  }

  /** The registry check's two activities, once each, as the workflow runs them. */
  async function check(request: RegistryCheckRequest, previous: RegistryLookups | null = null) {
    const lookups = await registry.lookupRegistries({ check: request, previous });
    if (!lookups) throw new Error('stale');
    return { lookups, result: await registry.matchRegistries({ check: request, lookups }) };
  }

  const caseRow = async (caseId: string) => {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(reviewCases).where(eq(reviewCases.id, caseId)),
    );
    if (!row) throw new Error('no case');
    return row;
  };
  const flagsOf = (caseId: string) =>
    api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewFlags)
        .where(eq(reviewFlags.caseId, caseId))
        .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id)),
    );
  const checksOf = async (caseId: string) =>
    (
      await api.asPlatform((tx) =>
        tx.select().from(registryChecks).where(eq(registryChecks.caseId, caseId)),
      )
    ).map(
      ({ personKey, system, status, reason }) =>
        `${personKey} ${system} ${status} ${String(reason)}`,
    );
  const registryFlags = async (caseId: string) =>
    (await flagsOf(caseId))
      .filter((flag) => !['no-previous-version'].includes(flag.ruleId))
      .map((flag) => `${flag.ruleId} ${flag.severity}`)
      .sort();

  it('S4, S5, S9: a submitted declaration becomes a case, then its registries are checked: flags, statuses, score and review.registry.checked.v1', async () => {
    const version = wanjikuVersion();

    await api.consumer.submitted(submittedEvent('psc', version));

    const checked = await vi.waitFor(
      async () => {
        const [entry] = await api.asPlatform((tx) =>
          tx.select().from(reviewTimeline).where(eq(reviewTimeline.kind, 'registry-checked')),
        );
        if (!entry) throw new Error('not checked yet');
        return entry;
      },
      { timeout: 45_000, interval: 250 },
    );
    const caseId = checked.caseId;
    const row = await caseRow(caseId);

    expect(await registryFlags(caseId)).toEqual([
      'directorship-employer-supplier high',
      'registry-parcel-undeclared high',
      'registry-vehicle-undeclared medium',
    ]);
    // S8: the score holds the registry flags with the deterministic ones (here info only).
    expect(row).toMatchObject({
      score: 17,
      band: 'high',
      openFlags: 4,
      registryUnavailable: false,
    });
    expect((await flagsOf(caseId)).every((flag) => flag.versionId === version.versionId)).toBe(
      true,
    );
    expect((await checksOf(caseId)).sort()).toEqual(
      [
        'officer kra matched null',
        'officer ntsa mismatched null',
        'officer brs mismatched null',
        'officer ardhisasa mismatched null',
        ...[SPOUSE, IMANI_KEY, BARAKA_KEY].flatMap((person) =>
          ['kra', 'ntsa', 'brs', 'ardhisasa'].map((system) => `${person} ${system} matched null`),
        ),
      ].sort(),
    );
    expect(checked.summary).toBe('Registries checked: 3 registry indicators');

    // Every lookup for the case, with the legal basis of processing; one supplier check.
    expect(api.gateway.lookups).toHaveLength(17);
    expect(api.gateway.lookups.every((lookup) => lookup.context.caseRef === caseId)).toBe(true);
    // ADR-008: the gateway audits reads of the results as reads of the declarant's data.
    expect(
      api.gateway.lookups.every((lookup) => lookup.context.subjectPersonId === row.personId),
    ).toBe(true);
    expect(
      api.gateway.lookups.every(
        (lookup) => lookup.context.tenant === 'psc' && lookup.context.legalBasis === 'regs-r20-1-b',
      ),
    ).toBe(true);
    expect(
      api.gateway.lookups.filter((l) => l.operation === 'supplies').map((l) => l.subject),
    ).toEqual(['KEMSA:PVT-9XYZ2L4Q']);

    const events = await api.db.select().from(outbox).orderBy(asc(outbox.createdAt));
    expect(events.map((event) => event.eventType)).toEqual([
      'review.case.created.v1',
      'review.registry.checked.v1',
    ]);
    const event = events[1]?.envelope;
    expect(event).toMatchObject({
      subject: caseId,
      tenant: 'psc',
      data: {
        caseId,
        versionId: version.versionId,
        band: 'high',
        flags: 3,
        systems: { kra: 'matched', ntsa: 'mismatched', brs: 'mismatched', ardhisasa: 'mismatched' },
      },
    });
    expect(event?.data.checks).toHaveLength(16);

    // Identifiers and statuses only, in the event and in the workflow's history.
    const history = await historyPayloads(temporalOf(api), processingWorkflowId(version.versionId));
    for (const text of [JSON.stringify(event), history]) {
      for (const personal of [
        WANJIKU.nationalId,
        PETER.nationalId,
        'A004518637K',
        'Land Cruiser Prado',
        'Afya Bora',
        'KAJIADO/KITENGELA/59821',
      ]) {
        expect(text).not.toContain(personal);
      }
    }
    expect(history).toContain(caseId);
  });

  it('S7: a child without a national ID is no-id in every registry and never looked up', async () => {
    const request = await caseOf(wanjikuVersion({ baraka: undefined }));

    await check(request);

    const checks = await checksOf(request.caseId);
    expect(checks.filter((c) => c.startsWith(BARAKA_KEY)).sort()).toEqual(
      ['ardhisasa', 'brs', 'kra', 'ntsa'].map((system) => `${BARAKA_KEY} ${system} no-id null`),
    );
    expect(api.gateway.lookups.map((lookup) => lookup.subject)).not.toContain(BARAKA.nationalId);
    // The spouse, who has an ID, is checked; so is the other child.
    expect(api.gateway.lookups.filter((l) => l.subject === PETER.nationalId)).toHaveLength(4);
    expect(api.gateway.lookups.filter((l) => l.subject === IMANI.nationalId)).toHaveLength(4);
  });

  it('S9: ArdhiSasa unavailable: its status and reason on the case, the other registries matched, the queue filter', async () => {
    const request = await caseOf(wanjikuVersion());
    api.gateway.failRegistry('ardhisasa', { kind: 'unavailable', reason: 'timeout' });

    const { result } = await check(request);

    expect(result).toMatchObject({ outcome: 'checked', flags: 2 });
    const checks = await checksOf(request.caseId);
    expect(checks.filter((c) => c.includes(' ardhisasa '))).toEqual(
      ['officer', SPOUSE, IMANI_KEY, BARAKA_KEY].map((p) => `${p} ardhisasa unavailable timeout`),
    );
    expect(checks).toContain('officer ntsa mismatched null');
    // Nothing is inferred from a registry that gave no answer.
    expect(await registryFlags(request.caseId)).toEqual([
      'directorship-employer-supplier high',
      'registry-vehicle-undeclared medium',
    ]);
    expect(await caseRow(request.caseId)).toMatchObject({ registryUnavailable: true, score: 10 });
    const [timeline] = await api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewTimeline)
        .where(
          and(
            eq(reviewTimeline.caseId, request.caseId),
            eq(reviewTimeline.kind, 'registry-checked'),
          ),
        ),
    );
    expect(timeline?.summary).toBe(
      'Registries checked: 2 registry indicators; not reached: ArdhiSasa',
    );

    const queue = '/v1/commissions/psc/review/queue';
    const unavailable = await api.get(`${queue}?registryUnavailable=true`, reviewer);
    expect(unavailable.statusCode).toBe(200);
    const page = unavailable.json<CasePage>();
    expect(contractErrors(okResponse('/v1/commissions/{slug}/review/queue', 'get'), page)).toEqual(
      [],
    );
    expect(page.items.map((item) => [item.id, item.registryUnavailable])).toEqual([
      [request.caseId, true],
    ]);
    const others = await api.get(`${queue}?registryUnavailable=false`, reviewer);
    expect(others.json<CasePage>().items).toEqual([]);
  });

  it('S9: the gateway itself unreachable is unavailable with no result; looked up again, only what was unavailable is', async () => {
    const request = await caseOf(wanjikuVersion());
    api.gateway.failRegistry('kra', { kind: 'gateway-down' }, 4);

    const first = await registry.lookupRegistries({ check: request, previous: null });
    expect(first?.persons.officer?.kra).toEqual({
      outcome: 'unavailable',
      reason: 'gateway-unavailable',
      resultId: null,
      checkedAt: null,
    });
    const before = api.gateway.lookups.length;

    const again = await registry.lookupRegistries({ check: request, previous: first });

    // Only the four KRA lookups again; everything else was answered.
    expect(api.gateway.lookups.slice(before).map((l) => l.system)).toEqual([
      'kra',
      'kra',
      'kra',
      'kra',
    ]);
    expect(again?.persons.officer?.kra?.outcome).toBe('found');
    expect(again?.persons.officer?.ntsa).toEqual(first?.persons.officer?.ntsa);
    expect(again?.suppliers).toEqual(first?.suppliers);
  });

  it('a lookup the gateway refuses is unavailable (gateway-rejected) and not looked up again', async () => {
    const request = await caseOf(wanjikuVersion());
    api.gateway.failRegistry('ntsa', { kind: 'refused' }, 1);

    const first = await registry.lookupRegistries({ check: request, previous: null });
    expect(first?.persons.officer?.ntsa).toEqual({
      outcome: 'unavailable',
      reason: 'gateway-rejected',
      resultId: null,
      checkedAt: null,
    });
    const before = api.gateway.lookups.length;

    const again = await registry.lookupRegistries({ check: request, previous: first });

    expect(api.gateway.lookups.slice(before)).toEqual([]);
    expect(again?.persons.officer?.ntsa?.reason).toBe('gateway-rejected');
  });

  it('a stored result the gateway refuses to give leaves its registry unavailable (gateway-rejected); the check goes on', async () => {
    const request = await caseOf(wanjikuVersion());
    const lookups = await registry.lookupRegistries({ check: request, previous: null });
    if (!lookups) throw new Error('stale');
    api.gateway.refuseStoredResults();

    const result = await registry.matchRegistries({ check: request, lookups });

    expect(result.outcome).toBe('checked');
    expect(await checksOf(request.caseId)).toContain('officer ntsa unavailable gateway-rejected');
  });

  it('storing the same check twice changes nothing; a reviewed registry flag keeps its note', async () => {
    const request = await caseOf(wanjikuVersion());
    const { lookups } = await check(request);
    const [vehicle] = (await flagsOf(request.caseId)).filter(
      (flag) => flag.ruleId === 'registry-vehicle-undeclared',
    );
    const reviewed = await api.send(
      'POST',
      `/v1/review/cases/${request.caseId}/flags/${vehicle?.id ?? ''}/reviewed`,
      reviewer,
      { note: 'Sold in 2025; transfer pending at NTSA' },
    );
    expect(reviewed.statusCode).toBe(200);

    await registry.matchRegistries({ check: request, lookups });

    const flags = await flagsOf(request.caseId);
    expect(
      flags.filter(
        (flag) => flag.ruleId.startsWith('registry-') || flag.ruleId.startsWith('directorship'),
      ),
    ).toHaveLength(3);
    expect(flags.find((flag) => flag.id === vehicle?.id)?.reviewNote).toBe(
      'Sold in 2025; transfer pending at NTSA',
    );
    expect(await caseRow(request.caseId)).toMatchObject({ score: 17, openFlags: 3 });
  });

  it('a case that moved on to a later version is stale: nothing is looked up or stored', async () => {
    const request = await caseOf(wanjikuVersion());
    await api.asPlatform((tx) =>
      tx
        .update(reviewCases)
        .set({ currentVersionId: crypto.randomUUID(), currentVersion: 2 })
        .where(eq(reviewCases.id, request.caseId)),
    );

    expect(await registry.lookupRegistries({ check: request, previous: null })).toBeNull();
    expect(
      await registry.matchRegistries({ check: request, lookups: { persons: {}, suppliers: {} } }),
    ).toEqual({ outcome: 'stale' });
    expect(api.gateway.lookups).toEqual([]);
    expect(await checksOf(request.caseId)).toEqual([]);
  });

  describe('S12: the Registry tab', () => {
    it("pulls the records from the gateway by result id, pairs them with the declared items and shows each registry's flags", async () => {
      const version = wanjikuVersion();
      const request = await caseOf(version);
      await check(request);
      const readsBefore = api.gateway.storedReads.length;

      const response = await api.get(registryPath(request.caseId), reviewer);

      expect(response.statusCode).toBe(200);
      const view = response.json<RegistryView>();
      expect(contractErrors(okResponse('/v1/review/cases/{caseId}/registry', 'get'), view)).toEqual(
        [],
      );
      expect(view.persons.map((p) => [p.personKey, p.personName, p.hasNationalId])).toEqual([
        ['officer', 'James Otieno', true],
        [SPOUSE, 'Grace Otieno', true],
        [IMANI_KEY, 'Grace Otieno', true],
        [BARAKA_KEY, 'Grace Otieno', true],
      ]);
      const officer = view.persons[0];
      const ntsa = officer?.systems.find((s) => s.system === 'ntsa');
      const fielder = (
        version.document as { statements: { assets: { id: string; type: string }[] }[] }
      ).statements[0]?.assets.find((a) => a.type === 'vehicle');
      expect(ntsa?.status).toBe('mismatched');
      expect(
        ntsa?.rows.map((row) => [
          row.registryRecord.registrationNumber,
          row.relation,
          row.declaredItemId,
        ]),
      ).toEqual([
        ['KCX 214J', 'matched', fielder?.id],
        ['KDK 482M', 'not-declared', null],
      ]);
      expect(ntsa?.rows[1]?.registryRecord).toMatchObject({
        make: 'Toyota',
        model: 'Land Cruiser Prado',
      });
      expect(ntsa?.flags.map((flag) => flag.ruleId)).toEqual(['registry-vehicle-undeclared']);
      expect(officer?.systems.map((s) => s.system)).toEqual(['kra', 'ntsa', 'brs', 'ardhisasa']);
      expect(officer?.systems.find((s) => s.system === 'brs')?.flags.map((f) => f.ruleId)).toEqual([
        'directorship-employer-supplier',
      ]);
      // KRA: compliance and the income difference, no amount.
      expect(officer?.systems[0]?.rows[0]?.registryRecord).toEqual({
        pinPresent: true,
        complianceStatus: 'compliant',
        validUntil: '2027-06-30',
        incomeDifferencePercent: expect.any(Number) as number,
        incomeDirection: expect.any(String) as string,
      });

      // One read per answered result, for the Commission; the declaration read for the viewer.
      expect(api.gateway.storedReads.slice(readsBefore)).toHaveLength(16);
      expect(api.gateway.storedReads.every((read) => read.tenant === 'psc')).toBe(true);
      expect(api.declarations.reads.at(-1)).toMatchObject({
        actingSubject: 'reviewer-a',
        caseId: request.caseId,
      });

      // Nothing of the records is stored in review: no table holds a record's details or a
      // national ID; flags hold identifiers only (a parcel number, a registration).
      const stored = await everyRow();
      for (const detail of [
        'Toyota',
        'Land Cruiser Prado',
        'Mazda',
        'Afya Bora',
        'freehold',
        '2.0235',
        'A004518637K',
        WANJIKU.nationalId,
        PETER.nationalId,
        IMANI.nationalId,
      ]) {
        expect(stored).not.toContain(detail);
      }
      expect(stored).toContain('KDK 482M');
    });

    it('before any check every registry is not checked, with no records', async () => {
      const request = await caseOf(wanjikuVersion({ baraka: undefined }));

      const view = (await api.get(registryPath(request.caseId), reviewer)).json<RegistryView>();

      expect(view.checkedAt).toBeNull();
      expect(view.persons.flatMap((p) => p.systems.map((s) => s.status))).toEqual(
        Array.from({ length: 16 }, () => 'not-checked'),
      );
      expect(view.persons.map((p) => p.hasNationalId)).toEqual([true, true, true, false]);
      expect(api.gateway.storedReads).toEqual([]);
    });

    it('the gateway not answering is 502; another Commission and a declarant see nothing', async () => {
      const request = await caseOf(wanjikuVersion());
      await check(request);
      api.gateway.failStoredResults();

      const down = await api.get(registryPath(request.caseId), reviewer);
      expect(down.statusCode).toBe(502);
      expect(down.json()).toMatchObject({ type: 'integration-gateway-unavailable' });

      for (const caller of [
        { sub: 'reviewer-t', tenant: 'tsc', roles: ['reviewer'] },
        { sub: 'declarant', tenant: null, roles: ['declarant'] },
      ]) {
        expect((await api.get(registryPath(request.caseId), caller)).statusCode).toBe(404);
      }
    });

    it('a document outside declaration.v1 fails the check for good and the tab with 502 (ADR-013 §2)', async () => {
      const version = wanjikuVersion();
      const request = await caseOf(version);
      // Declarations answering outside its contract: statements is no list.
      version.document.statements = 'not a list';

      await expect(
        registry.lookupRegistries({ check: request, previous: null }),
      ).rejects.toMatchObject({ type: 'declaration-invalid', nonRetryable: true });
      expect(api.gateway.lookups).toEqual([]);
      const view = await api.get(registryPath(request.caseId), reviewer);
      expect(view.statusCode).toBe(502);
      expect(view.json()).toMatchObject({ type: 'declarations-unavailable' });
    });

    it('the case detail carries the statuses of the latest check', async () => {
      const request = await caseOf(wanjikuVersion());
      await check(request);

      const response = await api.get(`/v1/review/cases/${request.caseId}`, reviewer);

      expect(response.statusCode).toBe(200);
      const detail = response.json<CaseDetail>();
      expect(contractErrors(okResponse('/v1/review/cases/{caseId}', 'get'), detail)).toEqual([]);
      expect(detail.registry.checks).toHaveLength(16);
      expect(
        detail.registry.checks.slice(0, 4).map((c) => [c.personKey, c.system, c.status]),
      ).toEqual([
        ['officer', 'kra', 'matched'],
        ['officer', 'ntsa', 'mismatched'],
        ['officer', 'brs', 'mismatched'],
        ['officer', 'ardhisasa', 'mismatched'],
      ]);
      expect(detail.registry.checks.every((c) => c.resultId !== null)).toBe(true);
      expect(detail.case.registryUnavailable).toBe(false);
    });
  });

  /** Every row of every table of the review schema, as text. */
  async function everyRow(): Promise<string> {
    return api.asPlatform(async (tx) => {
      const tables = await tx.execute<{ name: string }>(
        sql`select table_name as name from information_schema.tables where table_schema = current_schema()`,
      );
      const texts: string[] = [];
      for (const { name } of tables.rows) {
        const rows = await tx.execute<{ text: string | null }>(
          sql`select json_agg(t)::text as text from ${sql.identifier(name)} t`,
        );
        texts.push(rows.rows[0]?.text ?? '');
      }
      return texts.join('\n');
    });
  }
});
