import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { ACCESS_OFFICER, APPLICANT, SUPERVISOR } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRequests } from '../../src/db/schema.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';

const fixtures = createRequire(import.meta.url);
/** A passport applicant's Form K (Daniel Otieno, UG). */
const MINIMAL = JSON.parse(
  readFileSync(
    fixtures.resolve('@adili/schemas/forms/fixtures/form-k.v1/valid/minimal.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const NOW = '2027-03-04T09:00:00.000Z';
const VERIFIED_AT = '2027-03-05T11:30:00.000Z';
const NOTE = 'Passport particulars checked against the copy the applicant brought to the office.';

interface Request {
  id: string;
  reference: string;
  status: string;
}

describe('Applicant verification of passport holders (S2)', () => {
  let api: AccessApi;
  const daniel: Caller = {
    sub: 'applicant-daniel',
    roles: [APPLICANT],
    personId: randomUUID(),
    name: 'Daniel Otieno',
  };
  const officer: Caller = {
    sub: 'officer-psc',
    roles: [ACCESS_OFFICER],
    tenant: 'psc',
    name: 'Peter Access',
  };

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  function given(identityStatus: 'verified' | 'pending-verification' = 'pending-verification') {
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.directory.givenCommission('tsc', 'Teachers Service Commission');
    api.directory.givenApplicant(daniel.personId ?? '', identityStatus);
    api.clock.set(NOW);
  }

  async function submit(body: unknown = MINIMAL): Promise<Request> {
    const response = await api.send('POST', '/v1/access/requests', daniel, body, {
      'idempotency-key': randomUUID(),
    });
    expect(response.statusCode).toBe(201);
    return response.json<Request>();
  }

  const verify = (id: string, body: unknown, caller: Caller = officer) =>
    api.send('POST', `/v1/access/requests/${id}/verify-applicant`, caller, body);

  async function rowOf(id: string) {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(accessRequests).where(eq(accessRequests.id, id)),
    );
    return row;
  }

  it('S2: a passport applicant pending verification files a request held pending-applicant-verification', async () => {
    given();

    const request = await submit();

    expect(request.status).toBe('pending-applicant-verification');
    expect(await rowOf(request.id)).toMatchObject({
      status: 'pending-applicant-verification',
      applicantIdentityStatus: 'pending-verification',
      applicantVerification: null,
    });
    // Received all the same: the reference, the register entry and its event.
    expect(request.reference).toMatch(/^ARQ-PSC-2027-0000001-/);
    expect(await api.events('access.request.received.v1')).toHaveLength(1);
  });

  it('S2: once the directory holds the applicant verified, their next request is submitted', async () => {
    given('verified');

    const request = await submit();

    expect(request.status).toBe('submitted');
    expect((await rowOf(request.id))?.applicantIdentityStatus).toBe('verified');
  });

  it('S2: the access officer verifies the applicant: the directory records it and the request is submitted', async () => {
    given();
    const request = await submit();
    api.clock.set(VERIFIED_AT);

    const response = await verify(request.id, { verified: true, note: NOTE });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(
      contractErrors(okResponse('/v1/access/requests/{requestId}/verify-applicant', 'post'), body),
    ).toEqual([]);
    expect(body).toMatchObject({
      id: request.id,
      status: 'submitted',
      applicantIdentityStatus: 'verified',
      resolvedRosterRecordId: null,
      representations: null,
      windowEndsAt: null,
      formK: { partI: { name: 'Daniel Otieno' } },
      timeline: [
        { kind: 'received', actor: 'Daniel Otieno' },
        { kind: 'verified', actor: 'Peter Access', at: VERIFIED_AT, summary: 'Request verified' },
      ],
    });
    expect(await rowOf(request.id)).toMatchObject({
      status: 'submitted',
      applicantIdentityStatus: 'verified',
      applicantVerification: {
        verified: true,
        note: NOTE,
        by: 'officer-psc',
        byName: 'Peter Access',
        at: VERIFIED_AT,
      },
    });
    // The identity status is the directory's: on the person and the account.
    expect(api.directory.verifications).toEqual([
      {
        personId: daniel.personId,
        tenant: 'psc',
        verifiedBy: 'officer-psc',
        idempotencyKey: expect.any(String) as unknown,
      },
    ]);
    expect(api.directory.identityStatusOf(daniel.personId ?? '')).toBe('verified');
    const events = await api.events('access.request.verified.v1');
    expect(events).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        subject: request.id,
        data: expect.objectContaining({
          kind: 'verified',
          reference: request.reference,
          actor: 'officer-psc',
          at: VERIFIED_AT,
        }) as unknown,
      }),
    ]);
    // The officer's note stays on the request: never in an event.
    expect(JSON.stringify(events)).not.toContain('Passport');

    // The applicant sees it go ahead, the officer unnamed.
    const mine = await api.get(`/v1/access/requests/${request.id}`, daniel);
    expect(mine.json()).toMatchObject({
      status: 'submitted',
      timeline: [{ kind: 'received' }, { kind: 'verified', actor: null }],
    });
  });

  it('not verified: the check is recorded, the request stays held, nothing is published', async () => {
    given();
    const request = await submit();

    const response = await verify(request.id, {
      verified: false,
      note: 'The particulars do not match the passport shown.',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'pending-applicant-verification',
      applicantIdentityStatus: 'pending-verification',
      timeline: [{ kind: 'received' }],
    });
    expect((await rowOf(request.id))?.applicantVerification).toMatchObject({ verified: false });
    expect(api.directory.verifications).toEqual([]);
    expect(await api.events('access.request.verified.v1')).toEqual([]);

    // The officer may verify it later.
    expect((await verify(request.id, { verified: true, note: NOTE })).statusCode).toBe(200);
    expect((await rowOf(request.id))?.status).toBe('submitted');
  });

  it('a request not held for verification is 409 not-pending-verification', async () => {
    given('verified');
    const request = await submit();

    const response = await verify(request.id, { verified: true, note: NOTE });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'not-pending-verification' });
    expect(api.directory.verifications).toEqual([]);
  });

  it('verifying twice: the second is 409 and the directory is asked once', async () => {
    given();
    const request = await submit();

    expect((await verify(request.id, { verified: true, note: NOTE })).statusCode).toBe(200);
    const again = await verify(request.id, { verified: true, note: NOTE });

    expect(again.statusCode).toBe(409);
    expect(api.directory.verifications).toHaveLength(1);
    expect(await api.events('access.request.verified.v1')).toHaveLength(1);
  });

  it('the directory down is 503 and nothing changes; trying again verifies', async () => {
    given();
    const request = await submit();
    api.directory.failCalls(1);

    const response = await verify(request.id, { verified: true, note: NOTE });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'directory-unavailable' });
    expect(await rowOf(request.id)).toMatchObject({
      status: 'pending-applicant-verification',
      applicantVerification: null,
    });
    expect(await api.events('access.request.verified.v1')).toEqual([]);

    expect((await verify(request.id, { verified: true, note: NOTE })).statusCode).toBe(200);
  });

  it("only the access officer of the request's Commission verifies: another Commission 404, the supervisor 403, an applicant 403", async () => {
    given();
    const request = await submit();

    const elsewhere = await verify(
      request.id,
      { verified: true, note: NOTE },
      { ...officer, tenant: 'tsc' },
    );
    const supervisor = await verify(
      request.id,
      { verified: true, note: NOTE },
      { sub: 'sup', roles: [SUPERVISOR], tenant: 'psc' },
    );
    const applicant = await verify(request.id, { verified: true, note: NOTE }, daniel);
    const none = await verify(randomUUID(), { verified: true, note: NOTE });

    expect(elsewhere.statusCode).toBe(404);
    expect(supervisor.statusCode).toBe(403);
    expect(applicant.statusCode).toBe(403);
    expect(none.statusCode).toBe(404);
    expect((await rowOf(request.id))?.status).toBe('pending-applicant-verification');
    expect(api.directory.verifications).toEqual([]);
  });

  it.each([
    [{ verified: true }, 'note'],
    [{ verified: true, note: '' }, 'note'],
    [{ verified: true, note: 'x'.repeat(1001) }, 'note'],
    [{ note: NOTE }, 'verified'],
    [{ verified: 'yes', note: NOTE }, 'verified'],
  ])('an invalid body %j is 400 at %s', async (body, path) => {
    given();
    const request = await submit();

    const response = await verify(request.id, body);

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toContain(
      path,
    );
  });
});
