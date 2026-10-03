import { Controller, Get } from '@nestjs/common';
import type { Principal } from '@adili/api-kit';
import { CircuitState } from 'cockatiel';
import { asc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CircuitBreakers } from '../src/adapter-kit/circuit-breakers.js';
import { LookupPurposeHeaders, Purpose } from '../src/adapter-kit/lookup-purpose.js';
import { PauseFlags } from '../src/adapter-kit/pause-flags.js';
import type { LookupContext, LookupPurpose } from '../src/adapter-kit/registry-adapter.js';
import { RegistryLookups } from '../src/adapter-kit/registry-lookups.js';
import { burstOf, type SystemPolicy } from '../src/adapter-kit/system-policies.js';
import { outbox, verificationResults } from '../src/db/schema.js';
import { REGISTRY_LOOKUP_PERFORMED } from '../src/verification/lookup-events.js';
import { SubjectHasher } from '../src/verification/subject-hasher.js';

import { StubAdapter, type StubRecord } from './support/stub-adapter.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** Echoes the purpose a caller declared, to drive `LookupPurposeHeaders` over HTTP. */
@Controller('internal/v1/test-purpose')
class PurposeEchoController {
  @Get()
  @LookupPurposeHeaders()
  echo(@Purpose() purpose: LookupPurpose): LookupPurpose {
    return purpose;
  }
}

const WANJIKU = '23456789';
const RECORD: StubRecord = { owner: 'Wanjiku Kamau', registrations: ['KDA 123A'] };

/** As the spec's defaults: 2 s timeout, 24 h cache; a rate the tests never reach. */
const KRA_POLICY: SystemPolicy = {
  timeoutMs: 2_000,
  cacheTtlSeconds: 86_400,
  ratePerMinute: 60_000,
  burst: burstOf(60_000),
  maxQueueMs: 1_000,
};
/** One call a second, no burst, at most 1.5 s in the queue: the third queued call is refused. */
const NTSA_POLICY: SystemPolicy = {
  timeoutMs: 2_000,
  cacheTtlSeconds: 86_400,
  ratePerMinute: 60,
  burst: 1,
  maxQueueMs: 1_500,
};
/**
 * KRA's shape at one call a second: two calls a lookup, reserved together (a burst of two), a
 * timeout shorter than the 2.5 s it may queue, so a wait that counted against it would show.
 */
const BRS_POLICY: SystemPolicy = {
  timeoutMs: 500,
  cacheTtlSeconds: 86_400,
  ratePerMinute: 60,
  burst: burstOf(60, 2),
  maxQueueMs: 2_500,
};

/** S3 and the kit's recording rules, against Postgres, Valkey and a stub adapter. */
describe('adapter kit', () => {
  let t: TestApp;
  let lookups: RegistryLookups;
  let pauses: PauseFlags;
  const kra = new StubAdapter('kra');
  const ntsa = new StubAdapter('ntsa');
  const brs = new StubAdapter('brs');

  const caller: Principal = {
    subject: 'service-account-review',
    tenant: null,
    roles: [],
    scopes: ['registry'],
    clientId: 'review',
    name: 'service-account-review',
    issuedAt: null,
    personId: null,
    acr: null,
    authTime: null,
    tokenId: null,
  };
  const forCase: LookupContext = {
    caller,
    purpose: { legalBasis: 'regs-r20-1-b', caseRef: 'case-0001', subjectPersonId: null },
    tenant: 'psc',
  };

  beforeAll(async () => {
    t = await createTestApp({
      policies: { kra: KRA_POLICY, ntsa: NTSA_POLICY, brs: BRS_POLICY },
      controllers: [PurposeEchoController],
    });
    // Unavailable registries and unrecorded results are logged by design; keep the run quiet.
    t.app.useLogger(false);
    lookups = t.app.get(RegistryLookups);
    pauses = t.app.get(PauseFlags);
    return () => t.close();
  });

  beforeEach(async () => {
    kra.reset();
    ntsa.reset();
    brs.reset();
    kra.records.set(WANJIKU, RECORD);
    t.cipher.unavailable = false;
    await t.clearCache();
    await t.db.delete(verificationResults);
    await t.db.delete(outbox);
  });

  const rows = () =>
    t.db
      .select()
      .from(verificationResults)
      .orderBy(asc(verificationResults.checkedAt), asc(verificationResults.id));

  /** Cached answers of the stub KRA, without the rate limit state beside them. */
  const answerKeys = async () =>
    (await t.cacheKeys()).filter((key) => key.startsWith('kra:records:'));

  const lookup = (subject: string, context: LookupContext = forCase, adapter = kra) =>
    lookups.lookup(adapter, subject, context);

  describe('outcomes', () => {
    it('answers found from the registry, then from the 24-hour cache', async () => {
      const first = await lookup(WANJIKU);
      const second = await lookup(WANJIKU);

      expect(first).toMatchObject({ outcome: 'found', data: RECORD, cached: false });
      expect(second).toMatchObject({ outcome: 'found', data: RECORD, cached: true });
      expect(kra.calls).toBe(1);
      const keys = await answerKeys();
      expect(keys).toEqual([expect.stringMatching(/^kra:records:[0-9a-f]{64}$/)]);
      expect(await t.valkey.ttl(keys[0] ?? '')).toBeGreaterThan(86_400 - 5);
    });

    it('caches not-found the same way', async () => {
      const first = await lookup('99999999');
      const second = await lookup('99999999');

      expect(first).toMatchObject({ outcome: 'not-found', cached: false });
      expect(second).toMatchObject({ outcome: 'not-found', cached: true });
      expect(kra.calls).toBe(1);
    });

    it('treats a cache entry of another shape as a miss', async () => {
      await lookup(WANJIKU);
      const [key] = await answerKeys();
      await t.valkey.set(key ?? '', JSON.stringify({ found: true, person: { name: 'old' } }));

      const result = await lookup(WANJIKU);

      expect(result).toMatchObject({ outcome: 'found', data: RECORD, cached: false });
      expect(kra.calls).toBe(2);
    });

    it('Q7: keeps answers encrypted in the cache, bound to their key', async () => {
      const hasher = t.app.get(SubjectHasher);
      const keyOf = (subject: string) => `kra:records:${hasher.hash('kra', subject)}`;
      await lookup(WANJIKU);
      await lookup('30000009');
      const raw = await t.valkey.get(keyOf(WANJIKU));

      expect(raw).toMatch(/^v1\./u);
      expect(raw).not.toContain('Wanjiku');
      expect(raw).not.toContain('KDA 123A');

      // An entry moved under another subject's key does not open there: a miss, not its answer.
      await t.valkey.set(keyOf('30000009'), raw ?? '');
      const callsBefore = kra.calls;
      expect(await lookup('30000009')).toMatchObject({ outcome: 'not-found', cached: false });
      expect(kra.calls).toBe(callsBefore + 1);
    });

    it('propagates an unexpected error after recording the lookup unavailable', async () => {
      kra.behaviour = { kind: 'throw', error: new TypeError('adapter bug') };

      await expect(lookup(WANJIKU)).rejects.toThrow('adapter bug');

      const [row] = await rows();
      expect(row).toMatchObject({ outcome: 'unavailable', reason: 'upstream-error' });
    });
  });

  describe('verification results', () => {
    it('records legal basis, case ref, subject hash, cached flag and the encrypted payload', async () => {
      const first = await lookup(WANJIKU);
      const second = await lookup(WANJIKU);

      const [fresh, cached] = await rows();
      expect(fresh).toMatchObject({
        id: first.resultId,
        system: 'kra',
        outcome: 'found',
        reason: null,
        cached: false,
        caller: 'review',
        tenant: 'psc',
        legalBasis: 'regs-r20-1-b',
        caseRef: 'case-0001',
      });
      expect(fresh?.subjectHash).toMatch(/^[0-9a-f]{64}$/);
      expect(cached).toMatchObject({ id: second.resultId, cached: true, tenant: 'psc' });
      expect(cached?.subjectHash).toBe(fresh?.subjectHash);

      for (const row of [fresh, cached]) {
        if (!row?.payloadCiphertext || !row.payloadEnvelope) throw new Error('No payload stored');
        expect(row.payloadEnvelope.tenant).toBe('psc');
        const plaintext = await t.cipher.decrypt({
          tenant: 'psc',
          recordId: row.id,
          ciphertext: row.payloadCiphertext,
          envelope: row.payloadEnvelope,
        });
        expect(JSON.parse(plaintext.toString('utf8'))).toEqual(RECORD);
      }
    });

    it('binds the payload to its row and tenant', async () => {
      await lookup(WANJIKU);
      await lookup(WANJIKU);
      const [first, second] = await rows();
      if (!first?.payloadCiphertext || !first.payloadEnvelope || !second) {
        throw new Error('No payload stored');
      }
      const sealed = { ciphertext: first.payloadCiphertext, envelope: first.payloadEnvelope };

      await expect(
        t.cipher.decrypt({ ...sealed, tenant: 'psc', recordId: second.id }),
      ).rejects.toThrow();
      await expect(
        t.cipher.decrypt({ ...sealed, tenant: 'judiciary', recordId: first.id }),
      ).rejects.toThrow();
    });

    it('keeps no payload for not-found, unavailable, or a lookup for no tenant', async () => {
      await lookup('99999999');
      kra.behaviour = { kind: 'fail' };
      await lookup('11111111');
      kra.behaviour = { kind: 'registry' };
      await t.clearCache();
      await lookup(WANJIKU, { ...forCase, tenant: null });

      const recorded = await rows();
      expect(recorded.map(({ outcome, tenant }) => ({ outcome, tenant }))).toEqual([
        { outcome: 'not-found', tenant: 'psc' },
        { outcome: 'unavailable', tenant: 'psc' },
        { outcome: 'found', tenant: null },
      ]);
      for (const row of recorded) {
        expect(row.payloadCiphertext).toBeNull();
        expect(row.payloadEnvelope).toBeNull();
      }
    });

    it('emits registry.lookup.performed.v1 per lookup with identifiers only', async () => {
      const first = await lookup(WANJIKU);
      const second = await lookup(WANJIKU, { ...forCase, tenant: null });
      const [row] = await rows();

      const events = await t.db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, REGISTRY_LOOKUP_PERFORMED))
        .orderBy(asc(outbox.id));

      const [fresh, cached, ...more] = events.map(({ envelope }) => envelope);
      expect(more).toEqual([]);
      expect(fresh).toMatchObject({ subject: first.resultId, tenant: 'psc' });
      expect(fresh?.data).toEqual({
        resultId: first.resultId,
        system: 'kra',
        outcome: 'found',
        reason: null,
        cached: false,
        legalBasis: 'regs-r20-1-b',
        caseRef: 'case-0001',
        subjectHash: row?.subjectHash,
        requestedBy: 'review',
      });
      expect(cached).toMatchObject({
        subject: second.resultId,
        tenant: 'platform',
        data: { resultId: second.resultId, cached: true },
      });
    });

    it('keeps names and national IDs out of the rows and events', async () => {
      await lookup(WANJIKU);

      const serialised = await t.db.execute<{ row: string }>(
        sql`select to_jsonb(v)::text as row from ${verificationResults} v
            union all select envelope::text from ${outbox}`,
      );
      const everything = serialised.rows.map(({ row }) => row).join('\n');
      for (const secret of [WANJIKU, 'Wanjiku', 'Kamau', 'KDA 123A']) {
        expect(everything).not.toContain(secret);
      }
    });

    it('answers without a result id when the payload cannot be encrypted', async () => {
      t.cipher.unavailable = true;

      const result = await lookup(WANJIKU);

      expect(result).toMatchObject({ outcome: 'found', data: RECORD, resultId: null });
      expect(await rows()).toEqual([]);
    });
  });

  describe('when the registry fails', () => {
    beforeEach(async () => {
      // Each case starts with a closed circuit: past any cool-down, one success closes it.
      t.clock.advance(30_000);
      expect((await lookup(WANJIKU)).outcome).toBe('found');
      await t.clearCache();
      kra.callTimes.length = 0;
    });

    // A subject nobody has looked up, so every call reaches the registry.
    const failFiveTimes = async () => {
      kra.behaviour = { kind: 'fail' };
      for (let i = 0; i < 5; i += 1) {
        expect(await lookup(`1000000${i}`)).toMatchObject({
          outcome: 'unavailable',
          reason: 'upstream-error',
        });
      }
      expect(kra.calls).toBe(5);
    };

    it('opens the circuit after five failures: unavailable without calling the registry', async () => {
      await failFiveTimes();
      kra.behaviour = { kind: 'registry' };

      const result = await lookup(WANJIKU);

      expect(result).toMatchObject({ outcome: 'unavailable', reason: 'breaker-open' });
      expect(kra.calls).toBe(5);
      const recorded = await rows();
      expect(recorded.at(-1)).toMatchObject({ outcome: 'unavailable', reason: 'breaker-open' });
    });

    it('recovers through a half-open probe after 30 seconds', async () => {
      await failFiveTimes();
      kra.behaviour = { kind: 'registry' };
      t.clock.advance(29_999);
      expect(await lookup(WANJIKU)).toMatchObject({ reason: 'breaker-open' });
      expect(kra.calls).toBe(5);

      t.clock.advance(1);
      const probe = await lookup(WANJIKU);

      expect(probe).toMatchObject({ outcome: 'found', cached: false });
      expect(kra.calls).toBe(6);
      expect(await lookup('99999999')).toMatchObject({ outcome: 'not-found', cached: false });
      expect(kra.calls).toBe(7);
    });

    it('opens again when the half-open probe fails', async () => {
      await failFiveTimes();
      t.clock.advance(30_000);

      expect(await lookup('20000000')).toMatchObject({ reason: 'upstream-error' });
      expect(await lookup('20000001')).toMatchObject({ reason: 'breaker-open' });
      expect(kra.calls).toBe(6);
    });

    it('times out at 2 seconds, aborting the call', async () => {
      kra.behaviour = { kind: 'hang' };

      const result = await lookup(WANJIKU);

      expect(result).toMatchObject({ outcome: 'unavailable', reason: 'timeout' });
      // Measured where the call runs: the lookup's own time adds the row write.
      expect(kra.abortedAfterMs).toBeGreaterThanOrEqual(1_999);
      expect(kra.abortedAfterMs).toBeLessThan(3_000);
      const [row] = (await rows()).slice(-1);
      expect(row).toMatchObject({ outcome: 'unavailable', reason: 'timeout' });
      expect(row?.latencyMs).toBeGreaterThanOrEqual(1_999);
    });
  });

  describe('pause', () => {
    beforeEach(() => pauses.resume('kra'));

    it('answers unavailable with reason paused without calling the registry', async () => {
      await pauses.pause('kra');

      const result = await lookup(WANJIKU);

      expect(result).toMatchObject({ outcome: 'unavailable', reason: 'paused' });
      expect(kra.calls).toBe(0);
      const [row] = await rows();
      expect(row).toMatchObject({ outcome: 'unavailable', reason: 'paused' });
    });

    it('still serves cached answers while paused, and calls again once resumed', async () => {
      await lookup(WANJIKU);
      await pauses.pause('kra');

      expect(await lookup(WANJIKU)).toMatchObject({ outcome: 'found', cached: true });
      expect(await lookup('99999999')).toMatchObject({ reason: 'paused' });

      await pauses.resume('kra');

      expect(await lookup('99999999')).toMatchObject({ outcome: 'not-found', cached: false });
      expect(kra.calls).toBe(2);
    });

    it('pauses one system only', async () => {
      await pauses.pause('kra');

      expect(await lookup(WANJIKU, forCase, ntsa)).toMatchObject({ outcome: 'not-found' });
    });
  });

  describe('rate limit', () => {
    it('queues calls to respect the per-system bucket, refusing past the max wait', async () => {
      const queued = performance.now();
      const results = await Promise.all(
        ['30000000', '30000001', '30000002'].map((subject) => lookup(subject, forCase, ntsa)),
      );

      const outcomes = results.map((result) =>
        result.outcome === 'unavailable' ? result.reason : result.outcome,
      );
      expect(outcomes.filter((outcome) => outcome === 'not-found')).toHaveLength(2);
      expect(outcomes.filter((outcome) => outcome === 'rate-limited')).toHaveLength(1);
      expect(ntsa.calls).toBe(2);
      // One a second, timed from the slots: the first slot falls after `queued`, the second a
      // second after it. The gap between the two calls is no measure: the first call can start
      // late after its slot (its reply waits on a busy event loop) while the second, timed on
      // Valkey's clock, starts on its slot. Within 2 ms: Valkey's TIME floored to the millisecond
      // and a Node timer firing up to a millisecond early.
      const [, second = 0] = ntsa.callTimes;
      expect(second - queued).toBeGreaterThanOrEqual(998);
    });
  });

  describe("M9: a lookup's calls are reserved together, outside its timeout", () => {
    const breakerState = () => t.app.get(CircuitBreakers).of('brs').state;
    const spread = (times: number[]) => Math.max(...times) - Math.min(...times);

    it('sends a lookup with a second PIN at once when the bucket is idle, charging the extra call', async () => {
      brs.callsPerLookup = 2;
      brs.extraCalls = 1;

      const result = await lookup('30000003', forCase, brs);

      expect(result).toMatchObject({ outcome: 'not-found' });
      expect(brs.calls).toBe(3);
      // None of the three queued for the rate limit.
      expect(spread(brs.callTimes)).toBeLessThan(100);
    });

    it('answers two lookups at once, the second queueing for its slots before its timeout starts', async () => {
      brs.callsPerLookup = 2;

      const results = await Promise.all(
        ['30000004', '30000005'].map((subject) => lookup(subject, forCase, brs)),
      );

      expect(results.map(({ outcome }) => outcome)).toEqual(['not-found', 'not-found']);
      expect(brs.calls).toBe(4);
      const [a = 0, b = 0, c = 0, d = 0] = brs.callTimes;
      // Each lookup's two calls together; the second lookup's two seconds later, longer than
      // the 500 ms timeout, which only started once its slots were free.
      expect(b - a).toBeLessThan(100);
      expect(d - c).toBeLessThan(100);
      expect(c - a).toBeGreaterThanOrEqual(1_990);
      expect(breakerState()).toBe(CircuitState.Closed);
    });

    it('refuses a lookup rate-limited before any of its calls when its slots are past the max wait, without tripping the breaker', async () => {
      brs.callsPerLookup = 2;
      brs.extraCalls = 1;
      await lookup('30000006', forCase, brs);
      brs.extraCalls = 0;

      // Three calls charged at one a second: the next two would wait three seconds, past 2.5 s.
      const result = await lookup('30000007', forCase, brs);

      expect(result).toMatchObject({ outcome: 'unavailable', reason: 'rate-limited' });
      expect(brs.calls).toBe(3);
      // Our own limit is no registry failure.
      expect(breakerState()).toBe(CircuitState.Closed);
      const [, row] = await rows();
      expect(row).toMatchObject({ outcome: 'unavailable', reason: 'rate-limited' });
    });
  });

  describe('legal basis headers', () => {
    const echo = async (headers: Record<string, string>, clientId = 'review') =>
      t.app.inject({
        method: 'GET',
        url: '/internal/v1/test-purpose',
        headers: {
          authorization: `Bearer ${await t.token({ clientId, scope: 'registry' })}`,
          ...headers,
        },
      });

    it('reads the legal basis and case reference', async () => {
      const response = await echo({ 'x-legal-basis': 'act-s35-5', 'x-case-ref': 'case-0001' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        legalBasis: 'act-s35-5',
        caseRef: 'case-0001',
        subjectPersonId: null,
      });
    });

    it('takes the case reference as optional', async () => {
      const response = await echo({ 'x-legal-basis': 'regs-r20-1-b' });

      expect(response.json()).toEqual({
        legalBasis: 'regs-r20-1-b',
        caseRef: null,
        subjectPersonId: null,
      });
    });

    it('reads the person the lookup is about; a malformed one is 400', async () => {
      const person = '0190A3B2-7C4D-7E8F-9A0B-1C2D3E4F5A6B';
      const response = await echo({ 'x-legal-basis': 'regs-r20-1-b', 'x-subject-person': person });

      expect(response.json()).toMatchObject({ subjectPersonId: person.toLowerCase() });
      const malformed = await echo({ 'x-legal-basis': 'regs-r20-1-b', 'x-subject-person': 'p-1' });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toMatchObject({ errors: [{ path: 'X-Subject-Person' }] });
    });

    it("takes the declarant's own request as a legal basis from the declarations service (spec 05b)", async () => {
      const response = await echo(
        {
          'x-legal-basis': 'declarant-request',
          'x-case-ref': '0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b',
        },
        'declarations',
      );

      expect(response.json()).toMatchObject({
        legalBasis: 'declarant-request',
        caseRef: '0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b',
      });
    });

    it.each([
      ['review', 'declarant-request'],
      ['declarations', 'regs-r20-1-b'],
      ['declarations', 'act-s35-5'],
      ['directory', 'regs-r20-1-b'],
    ])(
      "answers 403 when %s names %s, another service's basis (spec 05b story 17)",
      async (clientId, basis) => {
        const response = await echo(
          { 'x-legal-basis': basis, 'x-case-ref': 'case-0001' },
          clientId,
        );

        expect(response.statusCode).toBe(403);
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.json()).toMatchObject({ status: 403 });
      },
    );

    it.each([
      ['missing', {}],
      ['unknown', { 'x-legal-basis': 'curiosity' }],
      // Onboarding's basis is the IPRS route's own, never a caller's to name.
      ['adr-014-onboarding', { 'x-legal-basis': 'adr-014-onboarding' }],
    ])('answers 400 when the legal basis is %s', async (_, headers) => {
      const response = await echo(headers);

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        status: 400,
        errors: [{ path: 'X-Legal-Basis' }],
      });
    });

    it('answers 400 for a malformed case reference', async () => {
      const response = await echo({ 'x-legal-basis': 'act-s35-5', 'x-case-ref': 'a b' });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ errors: [{ path: 'X-Case-Ref' }] });
    });
  });
});
