import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { inbox, outbox, reviewCases } from '../../src/db/schema.js';
import { REFERRAL_ICMS_REGISTERED_CONSUMER } from '../../src/referrals/icms-registered.consumer.js';
import type { ReferralView } from '../../src/referrals/representation.js';
import { asset, declaration, statement } from '../fixtures/declarations.js';
import { givenAssignedCase } from '../support/cases.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { submittedVersion } from '../support/fake-declarations.js';
import { givenSentReferral, icmsRegisteredEvent, referralRows } from '../support/referrals.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';

/**
 * S12, the review side (spec 09 BE-5, BE-11): the reporting service pulls what ICMS needs of a
 * sent referral from the internal ICMS payload, with the declarant's national ID read from the
 * directory's roster record of the referral's case; and ICMS's case number comes back as
 * `referral.icms-registered.v1`, which the inbox records once on the Commission's referral. The
 * payload is for service tokens only, and the national ID appears nowhere but in it.
 */
describe('referrals: ICMS payload and case number (S12)', () => {
  let api: ReviewApi;

  const reporting: Caller = { sub: 'service-account-reporting', scopes: ['review:internal'] };
  const supervisorS: Caller = { sub: 'supervisor-s', tenant: 'psc', roles: ['supervisor'] };
  const reviewerA: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const tscSupervisor: Caller = { sub: 'supervisor-t', tenant: 'tsc', roles: ['supervisor'] };

  const NATIONAL_ID = '27450913';
  const REFERENCE = 'RFL-PSC-2027-0000001-4';
  const version = submittedVersion({
    tenant: 'psc',
    declarantName: 'James Otieno',
    personnelFileNumber: 'PSC/00042',
    document: declaration([statement('officer', { assets: [asset({ description: 'Plot' })] })]),
  });

  let caseId: string;
  let referralId: string;

  const payloadPath = (id: string) => `/internal/v1/review/referrals/${id}/icms-payload`;
  const pull = (id: string, caller: Caller, tenant = 'psc', headers: Record<string, string> = {}) =>
    api.get(payloadPath(id), caller, { 'x-acting-tenant': tenant, ...headers });
  const eventsOf = async (type: string) =>
    (await api.asPlatform((tx) => tx.select().from(outbox)))
      .filter((event) => event.envelope.type === type)
      .map((event) => event.envelope);
  const read = async (id: string, caller: Caller = supervisorS) => {
    const response = await api.get(`/v1/review/referrals/${id}`, caller);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<ReferralView>();
  };

  beforeAll(async () => {
    api = await startReviewApi();
  });

  afterAll(async () => {
    await api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
    api.declarations.given(version);
    api.directory.givenRosterRecord('psc', version.rosterRecordId, {
      personalNumber: 'PSC/00042',
      nationalId: NATIONAL_ID,
      employerCode: null,
      reportingEntityId: null,
    });
    caseId = await givenAssignedCase(api, version);
    referralId = await givenSentReferral(api, {
      tenant: 'psc',
      personId: version.personId,
      caseId,
      reference: REFERENCE,
    });
  });

  describe('ICMS payload (internal)', () => {
    it("S12: gives the reporting service the sent referral's cover sheet with the national ID from the roster record", async () => {
      const response = await pull(referralId, reporting, 'psc', {
        'x-acting-subject': 'analyst-e',
      });

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<unknown>();
      expect(
        contractErrors(
          okResponse('/internal/v1/review/referrals/{referralId}/icms-payload', 'get'),
          body,
        ),
      ).toEqual([]);
      expect(body).toEqual({
        reference: REFERENCE,
        grounds: 'undeclared-assets',
        groundsLabel: 'Undeclared assets',
        cycleYear: 2027,
        commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
        declarant: {
          name: 'James Otieno',
          personnelFileNumber: 'PSC/00042',
          nationalId: NATIONAL_ID,
        },
        narrative: 'NTSA records a vehicle registered to the officer that is not declared.',
        proposedBy: 'Amina Wafula',
        proposedAt: '2027-12-18T09:00:00.000Z',
        approvedBy: 'Samuel Njoroge',
        approvedAt: '2027-12-20T06:00:00.000Z',
        sentAt: '2027-12-20T06:00:00.000Z',
      });
      // Read from the directory at each call, by the case's roster record.
      expect(api.directory.rosterReads).toEqual([
        { tenant: 'psc', recordId: version.rosterRecordId },
      ]);

      // Audited (ADR-008) with the analyst the service acts for; the audit names ids only.
      const audited = await eventsOf('audit.read.v1');
      expect(audited).toHaveLength(1);
      expect(audited[0]).toMatchObject({
        tenant: 'psc',
        data: {
          action: 'review.referral.icms-payload.read',
          resource: { type: 'referral', params: { referralId } },
          actor: { subject: 'service-account-reporting', onBehalfOf: 'analyst-e' },
          outcome: 'success',
        },
      });

      // The national ID is in the payload only: not in any event, nor stored in the database.
      const outboxText = JSON.stringify(await api.asPlatform((tx) => tx.select().from(outbox)));
      expect(outboxText).not.toContain(NATIONAL_ID);
      const rows = JSON.stringify(await referralRows(api));
      expect(rows).not.toContain(NATIONAL_ID);
    });

    it('S12: audits a read that names no officer with the service alone', async () => {
      const response = await pull(referralId, reporting);

      expect(response.statusCode, response.body).toBe(200);
      const [audited] = await eventsOf('audit.read.v1');
      expect(audited?.data).toMatchObject({ actor: { subject: 'service-account-reporting' } });
      expect((audited?.data as { actor: object }).actor).not.toHaveProperty('onBehalfOf');
    });

    it('S12: a system referral with no case, or a case with no roster record, is 409 roster-record-unknown', async () => {
      const systemReferral = await givenSentReferral(api, {
        tenant: 'psc',
        personId: version.personId,
        caseId: null,
        reference: 'RFL-PSC-2027-0000002-2',
      });
      const noCase = await pull(systemReferral, reporting);
      expect(noCase.statusCode, noCase.body).toBe(409);
      expect(noCase.json()).toMatchObject({ code: 'roster-record-unknown' });

      await api.asPlatform((tx) =>
        tx.update(reviewCases).set({ rosterRecordId: null }).where(eq(reviewCases.id, caseId)),
      );
      const noRecord = await pull(referralId, reporting);
      expect(noRecord.statusCode, noRecord.body).toBe(409);
      expect(noRecord.json()).toMatchObject({ code: 'roster-record-unknown' });
      expect(api.directory.rosterReads).toEqual([]);
      expect(await eventsOf('audit.read.v1')).toEqual([]);
    });

    it('S12: a roster record the directory does not know is 409; the directory unreachable is 503', async () => {
      api.directory.reset();
      api.directory.givenCommission('psc');
      const unknown = await pull(referralId, reporting);
      expect(unknown.statusCode, unknown.body).toBe(409);
      expect(unknown.json()).toMatchObject({ code: 'roster-record-unknown' });

      api.directory.reset();
      const down = await pull(referralId, reporting);
      expect(down.statusCode, down.body).toBe(503);
      expect(down.json()).toMatchObject({ type: 'directory-unavailable' });
      expect(down.body).not.toContain(NATIONAL_ID);
    });

    it('S12: only a sent referral of the acting Commission has a payload (404 otherwise)', async () => {
      const approved = await givenSentReferral(api, {
        tenant: 'psc',
        personId: version.personId,
        caseId,
        reference: 'RFL-PSC-2027-0000003-0',
        status: 'approved',
      });

      expect((await pull(approved, reporting)).statusCode).toBe(404);
      expect((await pull(referralId, reporting, 'tsc')).statusCode).toBe(404);
      expect((await pull('0190d1c4-0000-7000-8000-000000000000', reporting)).statusCode).toBe(404);
      expect((await pull('not-a-uuid', reporting)).statusCode).toBe(400);
    });

    it('S12: the payload is for service tokens with review:internal only (401/403/400)', async () => {
      const anonymous = await api.app.inject({
        method: 'GET',
        url: payloadPath(referralId),
        headers: { 'x-acting-tenant': 'psc' },
      });
      expect(anonymous.statusCode).toBe(401);

      for (const caller of [
        supervisorS,
        reviewerA,
        tscSupervisor,
        { sub: 'service-account-other', scopes: ['documents:internal'] },
      ]) {
        const refused = await pull(referralId, caller);
        expect(refused.statusCode, caller.sub).toBe(403);
        expect(refused.body).not.toContain(NATIONAL_ID);
      }

      const noTenant = await api.get(payloadPath(referralId), reporting);
      expect(noTenant.statusCode).toBe(400);
      expect((await pull(referralId, reporting, 'platform')).statusCode).toBe(400);

      expect(api.directory.rosterReads).toEqual([]);
      expect(await eventsOf('audit.read.v1')).toEqual([]);
    });
  });

  describe('referral.icms-registered.v1 (inbox)', () => {
    it("S12: records ICMS's case number on the Commission's referral, once", async () => {
      const before = await read(referralId);
      expect(before).toMatchObject({ icmsCaseNumber: null, icmsRegisteredAt: null });

      const event = icmsRegisteredEvent('psc', {
        referralId,
        icmsCaseNumber: 'ICMS/2028/00017',
        registeredAt: '2028-01-05T10:30:00.000Z',
      });
      await api.icmsRegistered.registered(event);
      // Redelivered: handled once.
      await api.icmsRegistered.registered(event);

      const after = await read(referralId);
      expect(after).toMatchObject({
        status: 'sent',
        icmsCaseNumber: 'ICMS/2028/00017',
        icmsRegisteredAt: '2028-01-05T10:30:00.000Z',
      });
      expect(contractErrors(okResponse('/v1/review/referrals/{referralId}', 'get'), after)).toEqual(
        [],
      );
      // The reviewers' list shows it too.
      const list = await api.get('/v1/commissions/psc/referrals', reviewerA);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json<{ items: ReferralView[] }>().items).toEqual([
        expect.objectContaining({ id: referralId, icmsCaseNumber: 'ICMS/2028/00017' }),
      ]);

      const handled = await api.asPlatform((tx) =>
        tx.select().from(inbox).where(eq(inbox.consumer, REFERRAL_ICMS_REGISTERED_CONSUMER)),
      );
      expect(handled).toHaveLength(1);
      // Nothing is published: the event is reporting's record of the registration.
      const published = await api.asPlatform((tx) => tx.select().from(outbox));
      expect(published.filter((event) => event.envelope.type.startsWith('referral.'))).toEqual([]);
    });

    it('S12: a later registration never overwrites the case number', async () => {
      await api.icmsRegistered.registered(
        icmsRegisteredEvent('psc', {
          referralId,
          icmsCaseNumber: 'ICMS/2028/00017',
          registeredAt: '2028-01-05T10:30:00.000Z',
        }),
      );
      await api.icmsRegistered.registered(
        icmsRegisteredEvent('psc', {
          referralId,
          icmsCaseNumber: 'ICMS/2028/99999',
          registeredAt: '2028-02-01T10:30:00.000Z',
        }),
      );

      expect(await read(referralId)).toMatchObject({
        icmsCaseNumber: 'ICMS/2028/00017',
        icmsRegisteredAt: '2028-01-05T10:30:00.000Z',
      });
    });

    it("S12: an event naming another Commission's referral, or an unknown one, changes nothing", async () => {
      await api.icmsRegistered.registered(
        icmsRegisteredEvent('tsc', {
          referralId,
          icmsCaseNumber: 'ICMS/2028/00018',
          registeredAt: '2028-01-05T10:30:00.000Z',
        }),
      );
      await api.icmsRegistered.registered(
        icmsRegisteredEvent('psc', {
          referralId: '0190d1c4-0000-7000-8000-000000000000',
          icmsCaseNumber: 'ICMS/2028/00019',
          registeredAt: '2028-01-05T10:30:00.000Z',
        }),
      );

      expect(await read(referralId)).toMatchObject({
        icmsCaseNumber: null,
        icmsRegisteredAt: null,
      });
    });
  });
});
