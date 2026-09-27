import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/db/schema.js';
import { componentSchema, contractErrors } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';

/** Spec 01 scenario S13: the first authenticated request of a new reporting officer activates them. */
const PLATFORM_ADMIN: Caller = { sub: 'admin-1', tenant: 'platform', roles: ['platform-admin'] };

const OFFICER = {
  name: 'Fatuma Wanjiru',
  email: 'fatuma.wanjiru@tsc.go.ke',
  phone: '+254712345678',
};

const SUCCESSOR = {
  name: 'Brian Otieno',
  email: 'brian.otieno@tsc.go.ke',
  phone: '+254722000111',
};

interface Officer {
  id: string;
  state: string;
  invitedAt: string;
  activatedAt: string | null;
}

interface CommissionBody {
  id: string;
  reportingOfficer: Officer | null;
}

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  const created = await api.post(
    '/v1/commissions',
    { slug: 'tsc', name: 'Teachers Service Commission', type: 'hosted', categories: [] },
    PLATFORM_ADMIN,
  );
  expect(created.statusCode).toBe(201);
});

/** Assigns the officer over HTTP and returns the caller their new account signs in as. */
async function assignOfficer(): Promise<Caller> {
  const response = await api.put('/v1/commissions/tsc/reporting-officer', OFFICER, PLATFORM_ADMIN);
  expect(response.statusCode).toBe(200);
  const userId = api.identity.calls('sendActivationEmail')[0]?.userId;
  if (!userId) throw new Error('no activation email was sent');
  return officerCaller(userId);
}

const officerCaller = (sub: string): Caller => ({
  sub,
  tenant: 'tsc',
  roles: ['reporting-officer'],
});

const commission = async (slug = 'tsc') =>
  (await api.get(`/v1/commissions/${slug}`, PLATFORM_ADMIN)).json<CommissionBody>();

const activatedEvents = async () =>
  (await api.db.select({ type: outbox.eventType, envelope: outbox.envelope }).from(outbox)).filter(
    (event) => event.type === 'commission.reporting-officer.activated.v1',
  );

describe('S13 activation observed', () => {
  it('activates the assignment on the officer’s first GET /v1/me', async () => {
    const officer = await assignOfficer();
    expect((await commission()).reportingOfficer?.state).toBe('invited');

    const me = await api.get('/v1/me', officer);

    expect(me.statusCode).toBe(200);
    const body = await commission();
    expect(contractErrors(componentSchema('Commission'), body)).toEqual([]);
    expect(body.reportingOfficer?.state).toBe('activated');
    const activatedAt = Date.parse(body.reportingOfficer?.activatedAt ?? '');
    expect(Date.now() - activatedAt).toBeLessThan(60_000);
    expect(activatedAt).toBeGreaterThanOrEqual(Date.parse(body.reportingOfficer?.invitedAt ?? ''));

    const activated = await api.get('/v1/commissions?reportingOfficer=activated', PLATFORM_ADMIN);
    expect(activated.json<{ total: number }>().total).toBe(1);
  });

  it('records commission.reporting-officer.activated.v1 once, with ids only', async () => {
    const officer = await assignOfficer();

    await api.get('/v1/me', officer);
    await api.get('/v1/me', officer);
    // Still once after the cache forgets the officer: the state, not the cache, decides.
    api.activationLookups.expireAll();
    await api.get('/v1/me', officer);

    const { id: commissionId, reportingOfficer } = await commission();
    const events = await activatedEvents();
    expect(events).toHaveLength(1);
    const envelope = events[0]?.envelope;
    expect(envelope).toMatchObject({
      type: 'commission.reporting-officer.activated.v1',
      source: 'adili/directory',
      subject: commissionId,
      tenant: 'tsc',
      data: { commissionId, assignmentId: reportingOfficer?.id },
    });
    expect(Object.keys(envelope?.data ?? {}).sort()).toEqual(['assignmentId', 'commissionId']);
    const serialised = JSON.stringify(envelope);
    for (const personal of [OFFICER.name, OFFICER.email, OFFICER.phone]) {
      expect(serialised).not.toContain(personal);
    }
  });

  it('keeps the first activation date on later requests', async () => {
    const officer = await assignOfficer();
    await api.get('/v1/me', officer);
    const first = (await commission()).reportingOfficer?.activatedAt;

    api.activationLookups.expireAll();
    await api.get('/v1/me', officer);

    expect((await commission()).reportingOfficer?.activatedAt).toBe(first);
  });

  it('records one event when the first requests arrive together', async () => {
    const officer = await assignOfficer();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => api.get('/v1/me', officer)),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(await activatedEvents()).toHaveLength(1);
    expect((await commission()).reportingOfficer?.state).toBe('activated');
  });

  it('counts any authenticated request, and that request already sees the officer activated', async () => {
    const officer = await assignOfficer();

    const own = await api.get('/v1/commissions/tsc', officer);

    expect(own.statusCode).toBe(200);
    expect(own.json<CommissionBody>().reportingOfficer?.state).toBe('activated');
  });

  it('does not activate on anyone else’s request', async () => {
    await assignOfficer();

    await api.get('/v1/me', PLATFORM_ADMIN);
    await api.get('/v1/me', { sub: randomUUID(), tenant: 'tsc', roles: ['reviewer'] });

    expect((await commission()).reportingOfficer?.state).toBe('invited');
    expect(await activatedEvents()).toEqual([]);
  });

  it('looks only at tokens that carry the reporting-officer role', async () => {
    const officer = await assignOfficer();
    const withoutRole = { ...officer, roles: ['reviewer'] };

    await api.get('/v1/me', withoutRole);

    expect((await commission()).reportingOfficer?.state).toBe('invited');
    expect(api.activationLookups.knownNotInvited(officer.sub ?? '')).toBe(false);

    await api.get('/v1/me', officer);

    expect((await commission()).reportingOfficer?.state).toBe('activated');
  });

  it('does not fail the request when recording fails, and activates on the next one', async () => {
    const officer = await assignOfficer();
    await api.db.execute(sql`
      create function refuse_outbox() returns trigger language plpgsql as $$
      begin raise exception 'outbox unavailable'; end $$`);
    await api.db.execute(sql`
      create trigger refuse_outbox before insert on outbox
      for each row execute function refuse_outbox()`);
    let failed;
    try {
      failed = await api.get('/v1/me', officer);
    } finally {
      await api.db.execute(sql`drop trigger refuse_outbox on outbox`);
      await api.db.execute(sql`drop function refuse_outbox()`);
    }

    expect(failed.statusCode).toBe(200);
    expect((await commission()).reportingOfficer?.state).toBe('invited');

    await api.get('/v1/me', officer);

    expect((await commission()).reportingOfficer?.state).toBe('activated');
    expect(await activatedEvents()).toHaveLength(1);
  });
});

describe('observer off the hot path', () => {
  it('does not look a subject up again within the cache window once it had no invitation', async () => {
    const subject = randomUUID();
    await api.get('/v1/me', officerCaller(subject));
    // An invitation that appears behind the observer's back (not through assign) goes unseen...
    await givenCommissions(api.db, [
      {
        slug: 'psc',
        name: 'Public Service Commission',
        officer: { state: 'invited', keycloakUserId: subject },
      },
    ]);

    await api.get('/v1/me', officerCaller(subject));
    expect((await commission('psc')).reportingOfficer?.state).toBe('invited');

    // ...until the negative lookup expires.
    api.activationLookups.expireAll();
    await api.get('/v1/me', officerCaller(subject));
    expect((await commission('psc')).reportingOfficer?.state).toBe('activated');
  });

  it('looks an existing account up again once it is assigned', async () => {
    const userId = api.identity.seedUser({
      email: OFFICER.email,
      tenant: 'tsc',
      roles: ['reviewer'],
    });
    const staff = { sub: userId, tenant: 'tsc', roles: ['reviewer'] };
    await api.get('/v1/me', staff);

    await api.put('/v1/commissions/tsc/reporting-officer', OFFICER, PLATFORM_ADMIN);
    await api.get('/v1/me', { ...staff, roles: ['reviewer', 'reporting-officer'] });

    expect((await commission()).reportingOfficer?.state).toBe('activated');
    expect(await activatedEvents()).toHaveLength(1);
  });

  it('looks a replacing officer’s existing account up again once they replace the officer', async () => {
    await assignOfficer();
    const userId = api.identity.seedUser({
      email: SUCCESSOR.email,
      tenant: 'tsc',
      roles: ['reviewer'],
    });
    const staff = { sub: userId, tenant: 'tsc', roles: ['reviewer'] };
    await api.get('/v1/me', staff);

    const replaced = await api.put(
      '/v1/commissions/tsc/reporting-officer',
      SUCCESSOR,
      PLATFORM_ADMIN,
    );
    expect(replaced.statusCode).toBe(200);
    await api.get('/v1/me', { ...staff, roles: ['reviewer', 'reporting-officer'] });

    expect((await commission()).reportingOfficer).toMatchObject({
      email: SUCCESSOR.email,
      state: 'activated',
    });
    expect(await activatedEvents()).toHaveLength(1);
  });

  it('looks a previously replaced officer up again once they are assigned again', async () => {
    const first = await assignOfficer();
    const replaced = await api.put(
      '/v1/commissions/tsc/reporting-officer',
      SUCCESSOR,
      PLATFORM_ADMIN,
    );
    expect(replaced.statusCode).toBe(200);
    // The replaced officer has no invitation waiting now, and is remembered so.
    await api.get('/v1/me', first);
    expect(api.activationLookups.knownNotInvited(first.sub ?? '')).toBe(true);

    const reassigned = await api.put(
      '/v1/commissions/tsc/reporting-officer',
      OFFICER,
      PLATFORM_ADMIN,
    );
    expect(reassigned.statusCode).toBe(200);
    await api.get('/v1/me', first);

    expect((await commission()).reportingOfficer).toMatchObject({
      email: OFFICER.email,
      state: 'activated',
    });
    expect(await activatedEvents()).toHaveLength(1);
  });
});
