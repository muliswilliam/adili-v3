import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../src/config.js';
import { referralFacts, referralIntake } from '../../src/db/schema.js';
import { ReferralIcmsActivities } from '../../src/referrals/activities.js';
import { referralIcmsRegistrationWorkflowId } from '../../src/referrals/contract.js';
import type { ReferralIcmsRegisteredData } from '../../src/referrals/events.js';
import type { ReferralIcmsPayload } from '../../src/review/review-client.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { referralSent } from '../support/events.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';

/**
 * S12 at the inbox and HTTP seams. `psc` sends a referral to EACC (`referral.sent.v1`): it lands
 * in EACC's referrals intake with its package document, once. An EACC analyst pushes it to ICMS:
 * review's ICMS payload (national ID, full name, grounds, details) goes to the gateway's
 * `submitReferral` with the `RFL` reference and the referring Commission; the case number is
 * stored, `registered`, and `referral.icms-registered.v1` published for review. Pushing again
 * sends nothing; while ICMS is unreachable the gateway is retried with backoff and the referral
 * left `push-failed` for a retry; a registration ICMS only accepted is followed to its case
 * number. The authorisation rows of the matrix. No personal data in the intake or the events.
 */
describe('Referrals intake and ICMS push (S12)', () => {
  let api: ReportingApi;

  const ANALYST: Caller = {
    sub: 'eacc-analyst-1',
    tenant: 'eacc',
    roles: ['eacc-analyst'],
    name: 'Amina Hassan',
  };
  const EACC_SUPERVISOR: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
    name: 'Joseph Mwangi',
  };
  const PSC_SUPERVISOR: Caller = { sub: 'supervisor-psc', tenant: 'psc', roles: ['supervisor'] };
  const PSC_ADMIN: Caller = { sub: 'admin-psc', tenant: 'psc', roles: ['commission-admin'] };
  const PSC_REVIEWER: Caller = { sub: 'reviewer-psc', tenant: 'psc', roles: ['reviewer'] };
  /** EACC's role held for another tenant: not an EACC account. */
  const ANALYST_OF_PSC: Caller = { sub: 'odd-1', tenant: 'psc', roles: ['eacc-analyst'] };

  const SENT_AT = '2028-03-10T08:00:00.000Z';
  const REFERENCE = 'RFL-PSC-2028-0000001-5';
  const NATIONAL_ID = '23456789';
  const FULL_NAME = 'Wanjiru Kamau Otieno';

  const PAYLOAD: ReferralIcmsPayload = {
    reference: REFERENCE,
    grounds: 'two-missed-cycles',
    groundsLabel: 'Two missed declaration cycles (r.20(2))',
    commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
    declarant: { name: FULL_NAME, nationalId: NATIONAL_ID },
    narrative: 'The officer did not declare in the 2025 and 2027 cycles despite a notice.',
  };

  beforeAll(async () => {
    api = await startReportingApi();
  });

  afterAll(async () => {
    await api.close();
  });

  beforeEach(async () => {
    await api.reset();
    for (const slug of ['psc', 'tsc']) api.directory.givenCommission(slug);
  });

  /** `psc` sends a referral to EACC; review holds its ICMS payload. */
  async function givenSent(
    fixture: { tenant?: string; reference?: string; sentAt?: string } = {},
  ): Promise<{ referralId: string; packageDocumentId: string }> {
    const referralId = randomUUID();
    const packageDocumentId = randomUUID();
    const tenant = fixture.tenant ?? 'psc';
    const reference = fixture.reference ?? REFERENCE;
    await api.deliver(
      referralSent(tenant, referralId, fixture.sentAt ?? SENT_AT, { reference, packageDocumentId }),
    );
    api.review.givenReferral(tenant, referralId, { ...PAYLOAD, reference });
    return { referralId, packageDocumentId };
  }

  const list = (caller: Caller, query = '') => api.get(`/v1/eacc/referrals${query}`, caller);

  const push = (caller: Caller, referralId: string, key: string = randomUUID()) =>
    api.send('POST', `/v1/eacc/referrals/${referralId}/push`, caller, undefined, {
      'idempotency-key': key,
    });

  const intakeRow = async (referralId: string) => {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(referralIntake).where(eq(referralIntake.referralId, referralId)),
    );
    return row;
  };

  it('S12: referral.sent.v1 lands in the intake with its package, once; no personal data stored', async () => {
    const referralId = randomUUID();
    const packageDocumentId = randomUUID();
    const personId = randomUUID();
    const event = referralSent('psc', referralId, SENT_AT, {
      reference: REFERENCE,
      packageDocumentId,
      personId,
    });

    expect(await api.deliver(event)).toBe(true);
    expect(await api.deliver(event)).toBe(false);

    const response = await list(ANALYST);
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(contractErrors(okResponse('/v1/eacc/referrals', 'get'), body)).toEqual([]);
    expect(body).toEqual({
      items: [
        {
          referralId,
          commission: { slug: 'psc', name: 'Public Service Commission' },
          reference: REFERENCE,
          grounds: 'two-missed-cycles',
          cycleYear: 2027,
          sentAt: SENT_AT,
          packageDocumentId,
          icmsStatus: 'not-pushed',
          icmsCaseNumber: null,
          icmsRegisteredAt: null,
          pushedAt: null,
          pushedBy: null,
          error: null,
        },
      ],
      nextCursor: null,
    });
    // Counted for the Commission's year by when it was sent (FY 2027: July 2027 to June 2028).
    const [fact] = await api.asPlatform((tx) => tx.select().from(referralFacts));
    expect(fact).toMatchObject({ referralId, reference: REFERENCE, fy: 2027 });
    // Identifiers, the reference, grounds and statuses only: not even the person's id.
    const stored = JSON.stringify(await intakeRow(referralId));
    expect(stored).not.toContain(personId);
    expect(stored).not.toMatch(/approver|supervisor-psc/);
  });

  it('S12: an analyst pushes a referral: ICMS registers it, the case number is stored and published', async () => {
    const { referralId } = await givenSent();

    const response = await push(ANALYST, referralId);

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(
      contractErrors(okResponse('/v1/eacc/referrals/{referralId}/push', 'post'), body),
    ).toEqual([]);
    expect(body).toMatchObject({
      referralId,
      icmsStatus: 'registered',
      icmsCaseNumber: 'ICMS/2028/000001',
      pushedBy: { subject: ANALYST.sub, name: 'Amina Hassan' },
      error: null,
    });
    expect(typeof body.icmsRegisteredAt).toBe('string');
    expect(typeof body.pushedAt).toBe('string');
    // What ICMS needs, pulled from review for the referring Commission, naming the analyst.
    expect(api.review.payloadCalls).toEqual([
      { tenant: 'psc', referralId, actingSubject: ANALYST.sub },
    ]);
    expect(api.gateway.submitted).toEqual([
      {
        tenant: 'psc',
        referralReference: REFERENCE,
        nationalId: NATIONAL_ID,
        fullName: FULL_NAME,
        referringCommission: 'PSC',
        grounds: PAYLOAD.groundsLabel,
        details: PAYLOAD.narrative,
      },
    ]);
    // The case number goes back to review with the Commission as tenant.
    const registered = await api.events('referral.icms-registered.v1');
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ tenant: 'psc', subject: referralId });
    const data = registered[0]?.data as ReferralIcmsRegisteredData;
    expect(data).toEqual({
      referralId,
      tenant: 'psc',
      icmsCaseNumber: 'ICMS/2028/000001',
      registeredAt: body.icmsRegisteredAt,
    });
    // The intake and every event carry no name, ID number or narrative.
    const everything = JSON.stringify([await intakeRow(referralId), await api.events()]);
    expect(everything).not.toContain(NATIONAL_ID);
    expect(everything).not.toContain(FULL_NAME);
    expect(everything).not.toContain(PAYLOAD.narrative);
  });

  it('S12: pushing twice is idempotent: nothing is sent again and the case number is published once', async () => {
    const { referralId } = await givenSent();
    const key = randomUUID();

    const first = await push(ANALYST, referralId, key);
    const replay = await push(ANALYST, referralId, key);
    const again = await push(EACC_SUPERVISOR, referralId);

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({
      icmsStatus: 'registered',
      icmsCaseNumber: first.json<{ icmsCaseNumber: string }>().icmsCaseNumber,
      pushedBy: { subject: ANALYST.sub },
    });
    expect(api.gateway.submitCalls).toBe(1);
    expect(api.review.payloadCalls).toHaveLength(1);
    expect(await api.events('referral.icms-registered.v1')).toHaveLength(1);
  });

  it('S12: gateway down: retried with backoff, then push-failed; pushing again registers it', async () => {
    const { referralId } = await givenSent();
    api.gateway.failCalls(config.ICMS_PUSH_ATTEMPTS);

    const failed = await push(ANALYST, referralId);

    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ code: 'icms-push-failed', error: 'icms-unavailable' });
    expect(api.gateway.submitCalls).toBe(config.ICMS_PUSH_ATTEMPTS);
    expect(await intakeRow(referralId)).toMatchObject({
      icmsStatus: 'push-failed',
      error: 'icms-unavailable',
      icmsCaseNumber: null,
      pushAttempts: 1,
    });
    const listed = await list(ANALYST, '?icmsStatus=push-failed');
    expect(listed.json<{ items: { referralId: string }[] }>().items).toEqual([
      expect.objectContaining({ referralId, icmsStatus: 'push-failed', error: 'icms-unavailable' }),
    ]);
    const pushFailed = await api.events('referral.icms-push-failed.v1');
    expect(pushFailed.map((event) => event.data)).toEqual([
      { referralId, tenant: 'psc', reference: REFERENCE, error: 'icms-unavailable' },
    ]);

    const retried = await push(ANALYST, referralId);

    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ icmsStatus: 'registered', error: null });
    expect(await intakeRow(referralId)).toMatchObject({ pushAttempts: 2 });
    expect(await api.events('referral.icms-registered.v1')).toHaveLength(1);
  });

  it('S12: an outage shorter than the retries still registers the referral in one push', async () => {
    const { referralId } = await givenSent();
    api.gateway.failCalls(config.ICMS_PUSH_ATTEMPTS - 1);

    const response = await push(ANALYST, referralId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ icmsStatus: 'registered' });
    expect(api.gateway.submitCalls).toBe(config.ICMS_PUSH_ATTEMPTS);
  });

  it('S12: review unreachable or ICMS refusing leaves the referral push-failed with a code', async () => {
    const unreadable = await givenSent({ reference: 'RFL-PSC-2028-0000002-3' });
    api.review.failPayloads(1);

    const noPayload = await push(ANALYST, unreadable.referralId);

    expect(noPayload.statusCode).toBe(502);
    expect(await intakeRow(unreadable.referralId)).toMatchObject({
      icmsStatus: 'push-failed',
      error: 'review-unavailable',
    });
    expect(api.gateway.submitCalls).toBe(0);

    const refused = await givenSent({ reference: 'RFL-PSC-2028-0000003-1' });
    api.gateway.rejectCalls(1);

    const rejected = await push(ANALYST, refused.referralId);

    expect(rejected.statusCode).toBe(502);
    expect(await intakeRow(refused.referralId)).toMatchObject({
      icmsStatus: 'push-failed',
      error: 'icms-rejected',
    });
    // A refusal is not retried.
    expect(api.gateway.submitCalls).toBe(1);

    const noRoster = await givenSent({ reference: 'RFL-PSC-2028-0000004-8' });
    api.review.refusePayloads(1);

    const unregistrable = await push(ANALYST, noRoster.referralId);

    expect(unregistrable.statusCode).toBe(502);
    expect(unregistrable.json()).toMatchObject({
      code: 'icms-push-failed',
      error: 'payload-refused',
    });
    expect(await intakeRow(noRoster.referralId)).toMatchObject({
      icmsStatus: 'push-failed',
      error: 'payload-refused',
    });
    expect(api.gateway.submitCalls).toBe(1);
  });

  it('S12: a registration ICMS only accepted is followed to its case number', async () => {
    const { referralId } = await givenSent();
    api.gateway.answer('pending');

    const response = await push(ANALYST, referralId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ icmsStatus: 'pushed', icmsCaseNumber: null });
    expect((await api.events('referral.icms-pushed.v1')).map((event) => event.data)).toEqual([
      expect.objectContaining({ referralId, tenant: 'psc', reference: REFERENCE }),
    ]);
    const handle = api.temporal.workflow.getHandle(
      referralIcmsRegistrationWorkflowId(referralId, 1),
    );
    expect((await handle.describe()).status.name).toBe('RUNNING');

    try {
      const activities = api.app.get(ReferralIcmsActivities);
      const input = { referralId, attempt: 1 };
      expect(await activities.checkIcmsRegistration(input)).toBe('pending');

      api.gateway.register(REFERENCE, 'ICMS/2028/000777', '2028-03-12T10:00:00.000Z');
      expect(await activities.checkIcmsRegistration(input)).toBe('registered');
      // Registered: a later check or the timeout leave it alone.
      expect(await activities.checkIcmsRegistration(input)).toBe('superseded');
      expect(await activities.recordIcmsTimeout(input)).toBe(false);
    } finally {
      await handle.terminate();
    }

    expect(await intakeRow(referralId)).toMatchObject({
      icmsStatus: 'registered',
      icmsCaseNumber: 'ICMS/2028/000777',
      icmsRegisteredAt: new Date('2028-03-12T10:00:00.000Z'),
    });
    expect((await api.events('referral.icms-registered.v1')).map((event) => event.data)).toEqual([
      {
        referralId,
        tenant: 'psc',
        icmsCaseNumber: 'ICMS/2028/000777',
        registeredAt: '2028-03-12T10:00:00.000Z',
      },
    ]);
  });

  it('S12: a push ICMS never registers in time is left push-failed', async () => {
    const { referralId } = await givenSent();
    api.gateway.answer('pending');
    await push(ANALYST, referralId);
    const handle = api.temporal.workflow.getHandle(
      referralIcmsRegistrationWorkflowId(referralId, 1),
    );
    await handle.terminate();

    const activities = api.app.get(ReferralIcmsActivities);
    // Another push supersedes the first one's wait.
    expect(await activities.recordIcmsTimeout({ referralId, attempt: 0 })).toBe(false);
    expect(await activities.recordIcmsTimeout({ referralId, attempt: 1 })).toBe(true);

    expect(await intakeRow(referralId)).toMatchObject({
      icmsStatus: 'push-failed',
      error: 'icms-registration-timeout',
    });
  });

  it('S12: the intake lists the latest sent first, filters by ICMS status and pages', async () => {
    const older = await givenSent({ sentAt: '2028-01-05T08:00:00.000Z', reference: 'RFL-PSC-1' });
    const newer = await givenSent({
      tenant: 'tsc',
      sentAt: '2028-02-05T08:00:00.000Z',
      reference: 'RFL-TSC-1',
    });
    const newest = await givenSent({ sentAt: '2028-03-05T08:00:00.000Z', reference: 'RFL-PSC-2' });
    await push(ANALYST, newer.referralId);

    const first = await list(EACC_SUPERVISOR, '?limit=2');
    const page = first.json<{ items: { referralId: string }[]; nextCursor: string | null }>();
    expect(page.items.map((item) => item.referralId)).toEqual([
      newest.referralId,
      newer.referralId,
    ]);
    expect(page.nextCursor).not.toBeNull();
    const second = await list(EACC_SUPERVISOR, `?limit=2&cursor=${page.nextCursor ?? ''}`);
    expect(second.json()).toEqual({
      items: [expect.objectContaining({ referralId: older.referralId })],
      nextCursor: null,
    });

    const registered = await list(ANALYST, '?icmsStatus=registered');
    expect(registered.json()).toEqual({
      items: [
        expect.objectContaining({
          referralId: newer.referralId,
          commission: { slug: 'tsc', name: 'Teachers Service Commission' },
        }),
      ],
      nextCursor: null,
    });
    expect((await list(ANALYST, '?cursor=not-a-cursor')).statusCode).toBe(400);
    expect((await list(ANALYST, '?icmsStatus=lost')).statusCode).toBe(400);
  });

  it('S12: authorisation: EACC analysts and supervisors only; everyone else 403', async () => {
    const { referralId } = await givenSent();

    for (const caller of [ANALYST, EACC_SUPERVISOR]) {
      expect((await list(caller)).statusCode).toBe(200);
    }
    for (const caller of [PSC_SUPERVISOR, PSC_ADMIN, PSC_REVIEWER, ANALYST_OF_PSC]) {
      expect((await list(caller)).statusCode).toBe(403);
      expect((await push(caller, referralId)).statusCode).toBe(403);
    }
    expect(api.gateway.submitCalls).toBe(0);
    expect((await push(EACC_SUPERVISOR, referralId)).statusCode).toBe(200);
    expect((await push(ANALYST, randomUUID())).statusCode).toBe(404);
    expect(
      (await api.send('POST', `/v1/eacc/referrals/${referralId}/push`, ANALYST)).statusCode,
    ).toBe(400);
  });
});
