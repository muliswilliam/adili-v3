import { PLATFORM_TENANT } from '@adili/api-kit';
import { withTenant } from '@adili/data-access';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../src/config.js';
import { onboardingFailures, onboardingSessions, outbox } from '../../src/db/schema.js';
import type {
  OnboardingCommission,
  OnboardingSession,
  OnboardingSessionCreated,
} from '../../src/onboarding/representation.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { getSession, givenRoster, identify, type IdentifyInput } from '../support/onboarding.js';

/**
 * Spec 03 S1-S6 over HTTP, without a bearer token as the portal BFF calls them: the public
 * Commission list, identify with its match rule and neutral no-match, already-onboarded,
 * no-roster, and the per-IP and per-IP-and-Commission rate limits on the injected clock.
 */

const WANJIRU = {
  personnelFileNumber: 'TSC/100200',
  fullName: 'Wanjiru Achieng Otieno',
  nationalId: '12345678',
  designation: 'Senior Teacher',
  reportingEntity: 'Kisumu Girls High School',
  email: 'wanjiru.otieno@tsc.go.ke',
  phone: '+254712345123',
};
const KIPRONO = {
  personnelFileNumber: 'TSC/300400',
  fullName: 'Kiprono Mutai Chebet',
  nationalId: '23456789',
};
const MWANGI = {
  personnelFileNumber: 'TSC/999999',
  fullName: 'Mwangi Njoroge Kamau',
  nationalId: '11111111',
  email: 'mwangi.kamau@tsc.go.ke',
  state: 'onboarded' as const,
};
const OUMA = {
  personnelFileNumber: 'TSC/200300',
  fullName: 'Brian Odhiambo Ouma',
  nationalId: '34567890',
  email: 'brian.ouma@tsc.go.ke',
  state: 'exited' as const,
};
const AMINA = {
  personnelFileNumber: 'PSC/500600',
  fullName: 'Amina Hassan Abdi',
  nationalId: '56789012',
  email: 'amina.abdi@psc.go.ke',
};

const NOW = new Date('2026-10-01T09:00:00Z');
const SESSIONS = '/v1/onboarding/sessions';
const COMMISSIONS = '/v1/onboarding/commissions';

let api: DirectoryApi;
/** A client address of its own per request, so per-IP budgets stay out of tests on other rules. */
let nextIp = 1;
const freshIp = () => `198.51.100.${nextIp++}`;

const asWanjiru: IdentifyInput = {
  commission: 'tsc',
  personnelFileNumber: WANJIRU.personnelFileNumber,
  nationalId: WANJIRU.nationalId,
};

async function outboxEvents() {
  return api.db
    .select({ type: outbox.eventType, envelope: outbox.envelope })
    .from(outbox)
    .orderBy(asc(outbox.id));
}

async function failuresOf(tenant: string) {
  const rows = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(onboardingFailures).where(eq(onboardingFailures.tenant, tenant)),
  );
  return rows.reduce((sum, row) => sum + row.failures, 0);
}

beforeAll(async () => {
  api = await startDirectoryApi();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  await givenCommissions(api.db, [
    { slug: 'tsc', name: 'Teachers Service Commission' },
    { slug: 'psc', name: 'Public Service Commission' },
    { slug: 'jsc', name: 'Judicial Service Commission' },
  ]);
  await givenRoster(api, 'tsc', [WANJIRU, KIPRONO, MWANGI, OUMA]);
  await givenRoster(api, 'psc', [AMINA]);
});

afterAll(async () => {
  await api.close();
});

describe('S1 public Commission list', () => {
  it('lists active Commissions by name with their key, issuer code and roster availability', async () => {
    const response = await api.anonymous({ url: COMMISSIONS, ip: freshIp() });

    expect(response.statusCode, response.body).toBe(200);
    const list = response.json<OnboardingCommission[]>();
    expect(contractErrors(okResponse(COMMISSIONS, 'get'), list)).toEqual([]);
    expect(list).toEqual([
      { slug: 'jsc', issuerCode: 'JSC', name: 'Judicial Service Commission', hasRoster: false },
      { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission', hasRoster: true },
      { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission', hasRoster: true },
    ]);
    expect(response.headers['ratelimit-limit']).toBe(
      String(config.RATE_LIMITS['onboarding-commissions']?.limit),
    );
  });

  it('searches by a fragment of the name, or the issuer code, case-insensitively', async () => {
    const byName = await api.anonymous({ url: `${COMMISSIONS}?search=SERVICE%20c`, ip: freshIp() });
    const byCode = await api.anonymous({ url: `${COMMISSIONS}?search=tsc`, ip: freshIp() });
    const none = await api.anonymous({ url: `${COMMISSIONS}?search=police`, ip: freshIp() });
    const tooLong = await api.anonymous({
      url: `${COMMISSIONS}?search=${'a'.repeat(101)}`,
      ip: freshIp(),
    });

    expect(byName.json<OnboardingCommission[]>().map(({ slug }) => slug)).toEqual([
      'jsc',
      'psc',
      'tsc',
    ]);
    expect(byCode.json<OnboardingCommission[]>().map(({ slug }) => slug)).toEqual(['tsc']);
    expect(none.json()).toEqual([]);
    expect(tooLong.statusCode).toBe(400);
  });

  it('serves the list from a cache for a minute', async () => {
    await api.anonymous({ url: COMMISSIONS, ip: freshIp() });
    await givenRoster(api, 'jsc', [{ ...KIPRONO, personnelFileNumber: 'JSC/1' }]);

    const cached = await api.anonymous({ url: `${COMMISSIONS}?search=jsc`, ip: freshIp() });
    api.clock.advance(60_000);
    const fresh = await api.anonymous({ url: `${COMMISSIONS}?search=jsc`, ip: freshIp() });

    expect(cached.json<OnboardingCommission[]>()[0]?.hasRoster).toBe(false);
    expect(fresh.json<OnboardingCommission[]>()[0]?.hasRoster).toBe(true);
  });
});

describe('S2 identify', () => {
  it('starts a session in email-pending with masked roster contacts, a code sent and the secret once', async () => {
    const response = await identify(
      api,
      { commission: 'tsc', personnelFileNumber: '  tsc/100200 ', nationalId: '1234 5678' },
      freshIp(),
    );

    expect(response.statusCode, response.body).toBe(201);
    const created = response.json<OnboardingSessionCreated>();
    expect(contractErrors(okResponse(SESSIONS, 'post', 201), created)).toEqual([]);
    expect(created).toEqual({
      id: expect.any(String) as unknown,
      secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown,
      state: 'email-pending',
      commission: {
        slug: 'tsc',
        issuerCode: 'TSC',
        name: 'Teachers Service Commission',
        hasRoster: true,
      },
      contacts: {
        email: { masked: 'w***@tsc.go.ke', source: 'roster', verified: false },
        phone: { masked: '07** *** 123', source: 'roster', verified: false },
      },
      details: null,
      otp: {
        channel: 'email',
        resendAvailableAt: '2026-10-01T09:01:00.000Z',
        resendsLeft: 3,
        attemptsLeft: 5,
      },
      outcome: null,
      ofr: null,
      setPasswordEmail: null,
      expiresAt: '2026-10-01T09:30:00.000Z',
    });

    // One code, to the roster email, naming the Commission.
    expect(api.otpDelivery.sent()).toEqual([
      {
        channel: 'email',
        to: WANJIRU.email,
        code: expect.stringMatching(/^\d{6}$/) as unknown,
        commissionName: 'Teachers Service Commission',
        expiresInMinutes: 10,
        tenant: 'tsc',
      },
    ]);

    // The secret opens the session and is never shown again.
    const read = await getSession(api, created.id, created.secret, freshIp());
    expect(read.statusCode, read.body).toBe(200);
    const { secret, ...session } = created;
    expect(read.json<OnboardingSession>()).toEqual(session);
    expect(read.body).not.toContain(secret);

    // Only the secret's hash and a keyed hash of the client address are stored.
    const [stored] = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      tx.select().from(onboardingSessions).where(eq(onboardingSessions.id, created.id)),
    );
    expect(stored?.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.secretHash).not.toContain(secret);
    expect(stored?.clientIpHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('records the start and the first step, not an end, and no identifiers', async () => {
    const response = await identify(api, asWanjiru, freshIp());
    const { id, secret } = response.json<OnboardingSessionCreated>();

    const events = await outboxEvents();
    expect(events.map(({ type }) => type)).toEqual([
      'onboarding.session.started.v1',
      'onboarding.session.advanced.v1',
    ]);
    expect(events.map(({ envelope }) => envelope.data)).toEqual([
      { sessionId: id, rosterRecordId: expect.any(String) as unknown },
      { sessionId: id, from: 'identified', state: 'email-pending' },
    ]);
    expect(events.every(({ envelope }) => envelope.tenant === 'tsc')).toBe(true);
    const code = api.otpDelivery.last()?.code ?? '';
    const serialised = JSON.stringify(events);
    for (const identifier of [
      WANJIRU.nationalId,
      WANJIRU.personnelFileNumber,
      WANJIRU.fullName,
      WANJIRU.email,
      WANJIRU.phone,
      secret,
      code,
    ]) {
      expect(serialised).not.toContain(identifier);
    }
  });

  it('asks for an email when the roster record has none, sending nothing', async () => {
    const response = await identify(
      api,
      {
        commission: 'tsc',
        personnelFileNumber: KIPRONO.personnelFileNumber,
        nationalId: KIPRONO.nationalId,
      },
      freshIp(),
    );

    expect(response.statusCode, response.body).toBe(201);
    const created = response.json<OnboardingSessionCreated>();
    expect(created).toMatchObject({
      state: 'email-contact-required',
      contacts: { email: null, phone: null },
      otp: { channel: null, resendAvailableAt: null, resendsLeft: 0, attemptsLeft: 0 },
    });
    expect(api.otpDelivery.sent()).toEqual([]);
  });

  it('answers 502 and keeps no session when the first code cannot be sent', async () => {
    api.otpDelivery.failNext();

    const response = await identify(api, asWanjiru, freshIp());

    expect(response.statusCode, response.body).toBe(502);
    expect(response.json()).toMatchObject({ code: 'otp-send-failed', status: 502 });
    expect(contractErrors(componentSchema('OnboardingProblem'), response.json())).toEqual([]);
    const sessions = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      tx.select().from(onboardingSessions),
    );
    expect(sessions).toEqual([]);
    expect(await outboxEvents()).toEqual([]);
  });

  it('rejects malformed input with 400 before matching', async () => {
    const responses = await Promise.all(
      [
        { ...asWanjiru, nationalId: '1234' },
        { ...asWanjiru, nationalId: '12345678901' },
        { ...asWanjiru, personnelFileNumber: '' },
        { ...asWanjiru, commission: 'Not A Slug' },
      ].map((body) => identify(api, body, freshIp())),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400]);
    expect(await failuresOf('tsc')).toBe(0);
  });
});

describe('S3 no-match', () => {
  const wrongNationalId: IdentifyInput = { ...asWanjiru, nationalId: '87654321' };
  const noSuchRecord: IdentifyInput = {
    commission: 'tsc',
    personnelFileNumber: 'TSC/555555',
    nationalId: '99999999',
  };
  const causes: Record<string, IdentifyInput> = {
    'wrong national ID': wrongNationalId,
    'wrong file number': { ...asWanjiru, personnelFileNumber: 'TSC/100201' },
    'exited record': {
      commission: 'tsc',
      personnelFileNumber: OUMA.personnelFileNumber,
      nationalId: OUMA.nationalId,
    },
    'no such record': noSuchRecord,
  };

  it('answers every cause with the same 404 no-match and counts each against the Commission', async () => {
    const bodies = [];
    for (const input of Object.values(causes)) {
      const response = await identify(api, input, freshIp());
      expect(response.statusCode, response.body).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      bodies.push(response.json<Record<string, unknown>>());
    }

    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({
      type: 'no-match',
      title: 'No matching roster record',
      status: 404,
      code: 'no-match',
      instance: SESSIONS,
    });
    expect(contractErrors(componentSchema('OnboardingProblem'), bodies[0])).toEqual([]);
    expect(await failuresOf('tsc')).toBe(4);
    expect(api.otpDelivery.sent()).toEqual([]);
  });

  it('takes comparable time for every cause', async () => {
    const rounds = 21;
    const timings: Record<string, number[]> = {};
    const entries = Object.entries(causes);
    // Warm up connections and code paths first.
    for (const [, input] of entries) await identify(api, input, freshIp());
    // Causes take turns within each round, so a machine getting busier or quieter over the
    // run (other suites in parallel) weighs on every cause alike.
    for (let round = 0; round < rounds; round++) {
      for (const [cause, input] of entries) {
        const started = performance.now();
        await identify(api, input, freshIp());
        (timings[cause] ??= []).push(performance.now() - started);
      }
    }

    // Every cause does the same work (one lookup, one failure count): the medians differ by
    // scheduling noise only (a few ms with other suites running), under three quarters of one.
    const medians = Object.fromEntries(
      Object.entries(timings).map(([cause, values]) => [
        cause,
        values.sort((a, b) => a - b)[Math.floor(rounds / 2)] ?? 0,
      ]),
    );
    const values = Object.values(medians);
    const spread = Math.max(...values) - Math.min(...values);
    expect(spread, JSON.stringify(medians)).toBeLessThan(Math.max(10, Math.min(...values) * 0.75));
  });

  it('records the abuse threshold event once when a window reaches it', async () => {
    const window = new Date('2026-10-01T09:00:00Z');
    await withTenant(api.db, { tenant: 'tsc', subject: 'test' }, (tx) =>
      tx.insert(onboardingFailures).values({
        tenant: 'tsc',
        windowStart: window,
        failures: config.ONBOARDING_ABUSE_THRESHOLD - 1,
      }),
    );

    await identify(api, noSuchRecord, freshIp());
    await identify(api, wrongNationalId, freshIp());

    const events = (await outboxEvents()).filter(
      ({ type }) => type === 'onboarding.abuse-threshold.v1',
    );
    expect(events.map(({ envelope }) => [envelope.tenant, envelope.data])).toEqual([
      ['tsc', { window: window.toISOString(), failures: config.ONBOARDING_ABUSE_THRESHOLD }],
    ]);
  });
});

describe('S4 already onboarded', () => {
  it('answers 409 already-onboarded with sign-in and recover-access links, and no session', async () => {
    const response = await identify(
      api,
      {
        commission: 'tsc',
        personnelFileNumber: MWANGI.personnelFileNumber,
        nationalId: MWANGI.nationalId,
      },
      freshIp(),
    );

    expect(response.statusCode, response.body).toBe(409);
    const problem = response.json<Record<string, unknown>>();
    expect(contractErrors(componentSchema('OnboardingProblem'), problem)).toEqual([]);
    expect(problem).toMatchObject({
      code: 'already-onboarded',
      links: {
        signIn: 'http://localhost:3010/auth/login',
        recoverAccess: 'http://localhost:3010/auth/recover',
      },
    });
    expect(await outboxEvents()).toEqual([]);
    expect(api.otpDelivery.sent()).toEqual([]);
    expect(await failuresOf('tsc')).toBe(0);
  });
});

describe('S5 no roster', () => {
  it('answers 409 no-roster before matching, using up no rate limit', async () => {
    const ip = freshIp();
    const refusals = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      refusals.push(await identify(api, { ...asWanjiru, commission: 'jsc' }, ip));
    }
    const afterwards = await identify(api, asWanjiru, ip);

    expect(refusals.map((response) => response.statusCode)).toEqual(Array(8).fill(409));
    expect(refusals[0]?.json()).toMatchObject({ code: 'no-roster', status: 409 });
    expect(refusals.map((response) => response.headers['ratelimit-remaining'])).toEqual(
      Array(8).fill('5'),
    );
    expect(afterwards.statusCode, afterwards.body).toBe(201);
    expect(afterwards.headers['ratelimit-remaining']).toBe('4');
    expect(await failuresOf('jsc')).toBe(0);
  });
});

describe('S5 unknown Commission', () => {
  it('answers 409 no-roster for a slug that is no active Commission, using up no rate limit', async () => {
    const ip = freshIp();
    const refusals = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      refusals.push(await identify(api, { ...asWanjiru, commission: 'kpa' }, ip));
    }

    expect(refusals.map((response) => response.statusCode)).toEqual(Array(6).fill(409));
    expect(refusals[0]?.json()).toMatchObject({ code: 'no-roster', status: 409 });
    expect(contractErrors(componentSchema('OnboardingProblem'), refusals[0]?.json())).toEqual([]);
    expect(refusals.map((response) => response.headers['ratelimit-remaining'])).toEqual(
      Array(6).fill('5'),
    );
    expect((await identify(api, asWanjiru, ip)).statusCode).toBe(201);
  });
});

describe('S6 rate limits', () => {
  it('refuses the sixth attempt from one IP within 15 minutes, with headers', async () => {
    const ip = freshIp();
    const other = freshIp();
    const attempts = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      attempts.push(await identify(api, { ...asWanjiru, nationalId: `8765432${attempt}` }, ip));
    }
    const sixth = await identify(api, asWanjiru, ip);

    expect(attempts.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404]);
    expect(attempts.map((response) => response.headers['ratelimit-remaining'])).toEqual([
      '4',
      '3',
      '2',
      '1',
      '0',
    ]);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers).toMatchObject({
      'ratelimit-limit': '5',
      'ratelimit-remaining': '0',
      'ratelimit-reset': '900',
      'retry-after': '900',
    });
    expect(sixth.json()).toMatchObject({ code: 'rate-limit-exceeded', retryAfterSeconds: 900 });
    expect(contractErrors(componentSchema('OnboardingProblem'), sixth.json())).toEqual([]);
    // Another address has its own budget.
    expect((await identify(api, asWanjiru, other)).statusCode).toBe(201);
  });

  it('still refuses a sixth attempt at minute 3, and at 14:59, then lets one in at 15:00', async () => {
    const ip = freshIp();
    for (let attempt = 0; attempt < 5; attempt++) {
      await identify(api, { ...asWanjiru, nationalId: `8765432${attempt}` }, ip);
    }

    // No attempt comes back before its 15 minutes are up (a token bucket gave one back every 3).
    api.clock.advance(3 * 60 * 1000);
    const atMinuteThree = await identify(api, asWanjiru, ip);
    expect(atMinuteThree.statusCode).toBe(429);
    expect(atMinuteThree.headers['retry-after']).toBe('720');
    api.clock.advance(12 * 60 * 1000 - 1_000);
    expect((await identify(api, asWanjiru, ip)).statusCode).toBe(429);

    api.clock.advance(1_000);
    const inWindow = await identify(api, asWanjiru, ip);
    expect(inWindow.statusCode, inWindow.body).toBe(201);
    expect(inWindow.headers['ratelimit-remaining']).toBe('4');
  });

  it('holds five attempts in any 15 minutes, however they are spread', async () => {
    const ip = freshIp();
    for (let minute = 0; minute < 5; minute++) {
      await identify(api, { ...asWanjiru, nationalId: `8765432${minute}` }, ip);
      api.clock.advance(2 * 60 * 1000);
    }

    // Minute 10: the first attempt (minute 0) leaves the window at minute 15.
    const refused = await identify(api, asWanjiru, ip);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBe('300');
    api.clock.advance(5 * 60 * 1000);
    expect((await identify(api, asWanjiru, ip)).statusCode).toBe(201);
    // Minute 15: the one from minute 2 still counts until minute 17.
    const next = await identify(api, { ...asWanjiru, nationalId: '87654329' }, ip);
    expect(next.statusCode).toBe(429);
    expect(next.headers['retry-after']).toBe('120');
  });

  describe('per IP and Commission', () => {
    let wide: DirectoryApi;

    beforeAll(async () => {
      // The per-IP budget out of the way, to show the per-IP-and-Commission one on its own:
      // with the default budgets one address runs out of the per-IP one first.
      wide = await startDirectoryApi({
        rateLimits: { 'onboarding-identify': { limit: 1000, windowSeconds: 900 } },
      });
    });

    afterAll(async () => {
      await wide.close();
    });

    it('refuses the 21st attempt for one Commission within an hour, not other Commissions', async () => {
      await wide.reset();
      wide.clock.set(NOW);
      await givenCommissions(wide.db, [
        { slug: 'tsc', name: 'Teachers Service Commission' },
        { slug: 'psc', name: 'Public Service Commission' },
      ]);
      await givenRoster(wide, 'tsc', [WANJIRU]);
      await givenRoster(wide, 'psc', [AMINA]);
      const ip = freshIp();

      const attempts = [];
      for (let attempt = 0; attempt < 20; attempt++) {
        attempts.push(await identify(wide, { ...asWanjiru, nationalId: '87654321' }, ip));
      }
      const twentyFirst = await identify(wide, asWanjiru, ip);
      const otherCommission = await identify(
        wide,
        {
          commission: 'psc',
          personnelFileNumber: AMINA.personnelFileNumber,
          nationalId: AMINA.nationalId,
        },
        ip,
      );

      expect(new Set(attempts.map((response) => response.statusCode))).toEqual(new Set([404]));
      expect(twentyFirst.statusCode).toBe(429);
      expect(twentyFirst.headers['ratelimit-limit']).toBe('20');
      expect(twentyFirst.json()).toMatchObject({ code: 'rate-limit-exceeded' });
      expect(otherCommission.statusCode, otherCommission.body).toBe(201);

      wide.clock.advance(60 * 60 * 1000);
      expect((await identify(wide, asWanjiru, ip)).statusCode).toBe(201);
    });
  });
});
