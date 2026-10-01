import { asc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox, verificationResults } from '../src/db/schema.js';
import { REGISTRY_LOOKUP_PERFORMED } from '../src/verification/lookup-events.js';

import { SEED, StubRegistries } from './support/stub-registries.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** Matchers typed `unknown`, so they sit in typed objects. */
const matching = (pattern: RegExp): unknown => expect.stringMatching(pattern);
const anyString = (): unknown => expect.any(String);
const RESULT_ID = /^[0-9a-f-]{36}$/;
const NOW = /^\d{4}-\d{2}-\d{2}T/;

/** A lookup's answer or problem, as far as the tests read it. */
type Body = { resultId: string; errors?: unknown } & Record<string, unknown>;

const without = (headers: Record<string, string>, name: string) =>
  Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));

/**
 * S1, S2 and S14 (spec 07b): the KRA, NTSA, BRS and ArdhiSasa lookups and the employer-supplier
 * check over HTTP, against Postgres, Valkey and a stub of the mocks serving the planted records.
 */
describe('registry lookups', () => {
  let registries: StubRegistries;
  let t: TestApp;
  let review: Record<string, string>;

  beforeAll(async () => {
    registries = await StubRegistries.start();
    t = await createTestApp({ registryUrls: registries.urls });
    // Unavailable registries and unrecorded results are logged by design; keep the run quiet.
    t.app.useLogger(false);
    const token = await t.token({ clientId: 'review', scope: 'registry' });
    review = {
      authorization: `Bearer ${token}`,
      'x-acting-tenant': 'psc',
      'x-legal-basis': 'regs-r20-1-b',
      'x-case-ref': 'case-0001',
    };
    // Pay undici's lazy start-up outside any lookup's timeout.
    await (await fetch(`${registries.urls.hr}/v1/employers/warm-up/suppliers`)).body?.cancel();
    return async () => {
      await t.close();
      await registries.close();
    };
  });

  beforeEach(async () => {
    registries.reset();
    t.cipher.unavailable = false;
    await t.clearCache();
    await t.db.delete(verificationResults);
    await t.db.delete(outbox);
  });

  const lookup = (path: string, nationalId: string, headers: Record<string, string> = review) =>
    t.app.inject({ method: 'POST', url: `/internal/v1/${path}`, headers, payload: { nationalId } });

  const supplies = (
    registration: string,
    employerCode: string,
    headers: Record<string, string> = review,
  ) =>
    t.app.inject({
      method: 'GET',
      url: `/internal/v1/brs/companies/${registration}/supplies?employerCode=${employerCode}`,
      headers,
    });

  const rows = () =>
    t.db
      .select()
      .from(verificationResults)
      .orderBy(asc(verificationResults.checkedAt), asc(verificationResults.id));

  const lookupEvents = async () =>
    (
      await t.db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, REGISTRY_LOOKUP_PERFORMED))
        .orderBy(asc(outbox.id))
    ).map(({ envelope }) => envelope);

  describe('S1 KRA', () => {
    it('answers the PIN with its compliance and declared income, then from the cache', async () => {
      const first = await lookup('kra/taxpayer-lookups', SEED.wanjiku);

      expect(first.statusCode).toBe(200);
      expect(first.json<Body>()).toEqual({
        resultId: matching(RESULT_ID),
        system: 'kra',
        outcome: 'found',
        reason: null,
        cached: false,
        checkedAt: matching(NOW),
        taxpayers: [
          {
            pin: 'A004518637K',
            registeredOn: '2006-03-01',
            compliance: {
              status: 'compliant',
              certificateNumber: `TCC${SEED.wanjiku}`,
              validUntil: '2027-06-30',
              annualIncomeDeclaredCents: 312_000_000,
            },
          },
        ],
      });
      // The PINs, then the PIN's compliance.
      expect(registries.calls.kra).toBe(2);

      const second = await lookup('kra/taxpayer-lookups', SEED.wanjiku);

      expect(second.json<Body>()).toMatchObject({ outcome: 'found', cached: true });
      expect(second.json<Body>().resultId).not.toBe(first.json<Body>().resultId);
      expect(second.json<Body>().taxpayers).toEqual(first.json<Body>().taxpayers);
      expect(registries.calls.kra).toBe(2);
    });

    it('answers non-compliant for Kiprono Chebet, without certificate or validity', async () => {
      const response = await lookup('kra/taxpayer-lookups', SEED.kiprono);

      expect(response.json<Body>().taxpayers).toEqual([
        {
          pin: 'A002260778R',
          registeredOn: '2001-03-01',
          compliance: {
            status: 'non-compliant',
            certificateNumber: null,
            validUntil: null,
            annualIncomeDeclaredCents: 264_000_000,
          },
        },
      ]);
    });

    it('answers not-found for an ID without a PIN, cached the same way', async () => {
      const first = await lookup('kra/taxpayer-lookups', SEED.imani);

      expect(first.statusCode).toBe(200);
      expect(first.json<Body>()).toMatchObject({
        outcome: 'not-found',
        reason: null,
        cached: false,
        taxpayers: [],
      });
      const second = await lookup('kra/taxpayer-lookups', SEED.imani);
      expect(second.json<Body>()).toMatchObject({ outcome: 'not-found', cached: true });
      expect(registries.calls.kra).toBe(1);
    });

    it('writes a result row with the legal basis, case, tenant and encrypted payload', async () => {
      const response = await lookup('kra/taxpayer-lookups', SEED.wanjiku);

      const [row, ...more] = await rows();
      expect(more).toEqual([]);
      expect(row).toMatchObject({
        id: response.json<Body>().resultId,
        system: 'kra',
        outcome: 'found',
        cached: false,
        caller: 'review',
        tenant: 'psc',
        legalBasis: 'regs-r20-1-b',
        caseRef: 'case-0001',
        subjectHash: matching(/^[0-9a-f]{64}$/),
      });
      expect(row?.payloadCiphertext).toEqual(expect.any(String));
      expect(row?.payloadCiphertext).not.toContain('A004518637K');
      expect(row?.payloadEnvelope).toMatchObject({ tenant: 'psc' });
    });
  });

  describe('S2 NTSA, BRS and ArdhiSasa', () => {
    it('returns the seeded vehicles, directorships and parcels', async () => {
      const ntsa = await lookup('ntsa/vehicle-lookups', SEED.wanjiku);
      const brs = await lookup('brs/directorship-lookups', SEED.wanjiku);
      const ardhisasa = await lookup('ardhisasa/parcel-lookups', SEED.wanjiku);

      expect(ntsa.json<Body>()).toMatchObject({ system: 'ntsa', outcome: 'found', cached: false });
      expect(ntsa.json<Body>().vehicles).toEqual([
        {
          registrationNumber: 'KCX 214J',
          make: 'Toyota',
          model: 'Fielder',
          yearOfManufacture: 2016,
          registeredOn: '2019-05-12',
        },
        {
          registrationNumber: 'KDK 482M',
          make: 'Toyota',
          model: 'Land Cruiser Prado',
          yearOfManufacture: 2023,
          registeredOn: '2024-11-04',
        },
      ]);
      expect(brs.json<Body>()).toMatchObject({ system: 'brs', outcome: 'found' });
      expect(brs.json<Body>().directorships).toEqual([
        {
          companyRegistrationNumber: 'PVT-9XYZ2L4Q',
          companyName: 'Afya Bora Medical Supplies Limited',
          companyStatus: 'active',
          role: 'director_shareholder',
          shares: 400,
          appointedOn: '2022-02-14',
        },
      ]);
      expect(ardhisasa.json<Body>()).toMatchObject({ system: 'ardhisasa', outcome: 'found' });
      expect(ardhisasa.json<Body>().parcels).toEqual([
        {
          parcelNumber: 'KIAMBU/RUIRU EAST BLOCK 2/4417',
          county: 'Kiambu',
          areaHectares: 0.045,
          tenure: 'freehold',
          registeredOn: '2014-09-03',
        },
        {
          parcelNumber: 'KAJIADO/KITENGELA/59821',
          county: 'Kajiado',
          areaHectares: 2.0235,
          tenure: 'freehold',
          registeredOn: '2025-01-17',
        },
      ]);
    });

    it('answers an unknown ID found with zero records, and caches it', async () => {
      for (const [path, records] of [
        ['ntsa/vehicle-lookups', 'vehicles'],
        ['brs/directorship-lookups', 'directorships'],
        ['ardhisasa/parcel-lookups', 'parcels'],
      ] as const) {
        const first = await lookup(path, SEED.unknown);
        const second = await lookup(path, SEED.unknown);

        expect(first.json<Body>()).toMatchObject({
          outcome: 'found',
          cached: false,
          [records]: [],
        });
        expect(second.json<Body>()).toMatchObject({
          outcome: 'found',
          cached: true,
          [records]: [],
        });
      }
      expect(registries.calls).toMatchObject({ ntsa: 1, brs: 1, ardhisasa: 1 });
    });

    it('answers true for the planted company and KEMSA, false otherwise', async () => {
      const planted = await supplies('PVT-9XYZ2L4Q', 'KEMSA');
      const other = await supplies('PVT-3KLM8R2T', 'KEMSA');
      const unknownEmployer = await supplies('PVT-9XYZ2L4Q', 'NOSUCH');

      expect(planted.statusCode).toBe(200);
      expect(planted.json<Body>()).toEqual({
        resultId: matching(RESULT_ID),
        system: 'hr-suppliers',
        outcome: 'found',
        reason: null,
        cached: false,
        checkedAt: matching(NOW),
        supplies: true,
      });
      expect(other.json<Body>()).toMatchObject({ outcome: 'found', supplies: false });
      expect(unknownEmployer.json<Body>()).toMatchObject({ outcome: 'found', supplies: false });

      const again = await supplies('PVT-9XYZ2L4Q', 'KEMSA');
      expect(again.json<Body>()).toMatchObject({ cached: true, supplies: true });
      expect(registries.calls.hr).toBe(3);
    });

    it('rejects a malformed registration number or employer code', async () => {
      expect((await supplies('PVT 9XYZ', 'KEMSA')).statusCode).toBe(400);
      expect((await supplies('PVT-9XYZ2L4Q', 'KEM:SA')).statusCode).toBe(400);
      expect(registries.calls.hr).toBe(0);
    });
  });

  describe('GET /internal/v1/registry-rate-limits', () => {
    it('gives the configured rate limit of every system with an adapter, to the registry scope alone', async () => {
      const read = (headers: Record<string, string>) =>
        t.app.inject({ method: 'GET', url: '/internal/v1/registry-rate-limits', headers });

      // No X-Acting-Tenant: configuration, not tenant data.
      const response = await read({ authorization: review.authorization ?? '' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        ['iprs', 'kra', 'ntsa', 'brs', 'ardhisasa', 'hr-suppliers'].map((system) => ({
          system,
          ratePerMinute: system === 'iprs' ? 1_200 : 60_000,
        })),
      );
      const other = await t.token({ clientId: 'directory', scope: 'iprs' });
      expect((await read({ authorization: `Bearer ${other}` })).statusCode).toBe(403);
    });
  });

  describe('when a registry does not answer', () => {
    it('answers unavailable with the reason and empty records, recorded', async () => {
      registries.behaviour.ntsa = { kind: 'status', status: 503 };
      registries.behaviour.hr = { kind: 'status', status: 500 };

      const ntsa = await lookup('ntsa/vehicle-lookups', SEED.wanjiku);
      const supplier = await supplies('PVT-9XYZ2L4Q', 'KEMSA');

      expect(ntsa.statusCode).toBe(200);
      expect(ntsa.json<Body>()).toMatchObject({
        resultId: matching(RESULT_ID),
        outcome: 'unavailable',
        reason: 'upstream-error',
        cached: false,
        vehicles: [],
      });
      expect(supplier.json<Body>()).toMatchObject({ outcome: 'unavailable', supplies: null });
      expect((await rows()).map((row) => row.reason)).toEqual(['upstream-error', 'upstream-error']);
    });

    it('opens the supplier lists circuit on HR failures, not the BRS one', async () => {
      registries.behaviour.hr = { kind: 'status', status: 500 };
      for (let call = 0; call < 5; call += 1) {
        await supplies(`PVT-${String(call)}FAIL`, 'KEMSA');
      }

      const supplier = await supplies('PVT-9XYZ2L4Q', 'KEMSA');
      const brs = await lookup('brs/directorship-lookups', SEED.wanjiku);

      expect(supplier.json<Body>()).toMatchObject({
        system: 'hr-suppliers',
        outcome: 'unavailable',
        reason: 'breaker-open',
      });
      expect(brs.json<Body>()).toMatchObject({ system: 'brs', outcome: 'found' });
      expect(registries.calls.brs).toBe(1);

      // Close the circuit again for the tests after: HR answers the probe past the cool-down.
      registries.behaviour.hr = { kind: 'registry' };
      t.clock.advance(30_001);
      expect((await supplies('PVT-9XYZ2L4Q', 'KEMSA')).json<Body>()).toMatchObject({
        outcome: 'found',
      });
    });

    it('answers rate-limited when the registry refuses the call for its own limit', async () => {
      registries.behaviour.ardhisasa = { kind: 'status', status: 429 };

      const response = await lookup('ardhisasa/parcel-lookups', SEED.wanjiku);

      expect(response.json<Body>()).toMatchObject({
        outcome: 'unavailable',
        reason: 'rate-limited',
      });
    });

    it('answers unavailable when KRA breaks its contract', async () => {
      registries.behaviour.kra = { kind: 'status', status: 200 };

      const response = await lookup('kra/taxpayer-lookups', SEED.wanjiku);

      expect(response.json<Body>()).toMatchObject({
        outcome: 'unavailable',
        reason: 'upstream-error',
      });
    });
  });

  it('refuses with 503 a lookup it cannot record, rather than answer unaudited', async () => {
    t.cipher.unavailable = true;

    const response = await lookup('ntsa/vehicle-lookups', SEED.wanjiku);

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<Body>()).toMatchObject({ type: 'lookup-not-recorded', status: 503 });
    expect(response.body).not.toContain('KCX 214J');
    expect(await rows()).toEqual([]);
  });

  describe('callers', () => {
    it('requires the registry scope', async () => {
      const token = await t.token({ clientId: 'directory', scope: 'iprs' });

      const response = await lookup('kra/taxpayer-lookups', SEED.wanjiku, {
        ...review,
        authorization: `Bearer ${token}`,
      });

      expect(response.statusCode).toBe(403);
      expect(registries.calls.kra).toBe(0);
    });

    it('refuses a user token, whatever headers it sends', async () => {
      const token = await t.token({ clientId: 'console', roles: ['reviewer'], tenant: 'psc' });

      const response = await lookup('ntsa/vehicle-lookups', SEED.wanjiku, {
        ...review,
        authorization: `Bearer ${token}`,
      });

      expect(response.statusCode).toBe(403);
    });

    it('requires the tenant the lookup acts for', async () => {
      const headers = without(review, 'x-acting-tenant');

      expect((await lookup('ntsa/vehicle-lookups', SEED.wanjiku, headers)).statusCode).toBe(400);
      expect(registries.calls.ntsa).toBe(0);
    });

    it('requires a known legal basis, without calling the registry', async () => {
      const headers = without(review, 'x-legal-basis');

      const missing = await lookup('brs/directorship-lookups', SEED.wanjiku, headers);
      const unknown = await lookup('brs/directorship-lookups', SEED.wanjiku, {
        ...review,
        'x-legal-basis': 'curiosity',
      });

      expect(missing.statusCode).toBe(400);
      expect(missing.json<Body>().errors).toEqual([
        { path: 'X-Legal-Basis', message: anyString() },
      ]);
      expect(unknown.statusCode).toBe(400);
      expect(registries.calls.brs).toBe(0);
      expect(await rows()).toEqual([]);
    });

    it('rejects a malformed national ID', async () => {
      const response = await lookup('ardhisasa/parcel-lookups', '12ab');

      expect(response.statusCode).toBe(400);
      expect(registries.calls.ardhisasa).toBe(0);
    });
  });

  describe('S14 audit', () => {
    it('emits registry.lookup.performed.v1 per call with legal basis and case ref', async () => {
      const fresh = await lookup('kra/taxpayer-lookups', SEED.wanjiku);
      const cached = await lookup('kra/taxpayer-lookups', SEED.wanjiku, {
        ...review,
        'x-legal-basis': 'act-s35-5',
        'x-case-ref': 'case-0002',
      });
      const supplier = await supplies('PVT-9XYZ2L4Q', 'KEMSA');

      const events = await lookupEvents();
      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({
        type: REGISTRY_LOOKUP_PERFORMED,
        subject: fresh.json<Body>().resultId,
        tenant: 'psc',
        data: {
          resultId: fresh.json<Body>().resultId,
          system: 'kra',
          outcome: 'found',
          reason: null,
          cached: false,
          legalBasis: 'regs-r20-1-b',
          caseRef: 'case-0001',
          subjectHash: matching(/^[0-9a-f]{64}$/),
          requestedBy: 'review',
        },
      });
      expect(events[1]).toMatchObject({
        subject: cached.json<Body>().resultId,
        data: { cached: true, legalBasis: 'act-s35-5', caseRef: 'case-0002' },
      });
      expect(events[2]).toMatchObject({
        subject: supplier.json<Body>().resultId,
        data: { system: 'hr-suppliers', outcome: 'found' },
      });
      expect(Object.keys(events[0]?.data ?? {}).sort()).toEqual(
        [
          'cached',
          'caseRef',
          'legalBasis',
          'outcome',
          'reason',
          'requestedBy',
          'resultId',
          'subjectHash',
          'system',
        ].sort(),
      );
    });

    it('keeps national IDs, names and registry records out of rows and events', async () => {
      for (const path of [
        'kra/taxpayer-lookups',
        'ntsa/vehicle-lookups',
        'brs/directorship-lookups',
        'ardhisasa/parcel-lookups',
      ]) {
        await lookup(path, SEED.wanjiku);
      }

      const serialised = await t.db.execute<{ row: string }>(
        sql`select to_jsonb(v)::text as row from ${verificationResults} v
            union all select envelope::text from ${outbox}`,
      );
      const everything = serialised.rows.map(({ row }) => row).join('\n');
      for (const secret of [
        SEED.wanjiku,
        'Wanjiku',
        'WANJIKU',
        'A004518637K',
        'KDK 482M',
        'KAJIADO',
        'Afya Bora',
      ]) {
        expect(everything).not.toContain(secret);
      }
    });
  });
});
