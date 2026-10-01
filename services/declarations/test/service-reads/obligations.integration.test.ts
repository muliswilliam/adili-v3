import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { filingObligations, outbox, rosterSnapshots } from '../../src/db/schema.js';
import type {
  InternalObligation,
  InternalObligationDetails,
  InternalPersonObligation,
} from '../../src/service-reads/representation.js';
import { contractErrors, okResponse, responseBody } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';

/**
 * Specs 08 #196 and 09 #220 over HTTP: one obligation and a person's history for the review
 * service's ladder and referral sweep, and the officers behind a batch of obligations for the
 * reporting service's Form M. Service tokens with `declarations:internal`, acting for the
 * Commission; another Commission's obligations are 404 or left out.
 */

const OBLIGATION = '/internal/v1/obligations/{obligationId}';
const HISTORY = '/internal/v1/persons/{personId}/obligations';
const DETAILS = '/internal/v1/obligations/details';

/** The review and reporting services' accounts (client credentials). */
const REVIEW: Caller = {
  sub: 'service-account-review',
  azp: 'review',
  scope: 'declarations:internal',
};
const REPORTING: Caller = {
  sub: 'service-account-reporting',
  azp: 'reporting',
  scope: 'declarations:internal',
};
const OFFICER: Caller = { sub: 'officer-psc', tenant: 'psc', roles: ['reporting-officer'] };

const MARY = randomUUID();

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
});

interface Given {
  tenant?: string;
  personId?: string | null;
  cycleKey?: string;
  dueDate?: string;
  status?: 'upcoming' | 'due' | 'overdue' | 'filed' | 'cancelled';
  filedAt?: Date | null;
  late?: boolean;
  designation?: string | null;
  exitDate?: string | null;
}

/** A roster record of the Commission and one obligation on it. */
async function givenObligation({
  tenant = 'psc',
  personId = MARY,
  cycleKey = 'biennial:2025',
  dueDate = '2025-12-31',
  status = 'overdue',
  filedAt = null,
  late = false,
  designation = 'Senior Accountant',
  exitDate = null,
}: Given = {}): Promise<{ obligationId: string; rosterRecordId: string }> {
  const rosterRecordId = randomUUID();
  const obligationId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(rosterSnapshots).values({
      rosterRecordId,
      tenant,
      personnelFileNumber: `${tenant.toUpperCase()}/0077`,
      fullName: 'Mary Wambui',
      designation,
      state: personId === null ? 'not_onboarded' : 'onboarded',
      appointmentDate: '2015-01-05',
      exitDate,
      personId,
      sourceUpdatedAt: new Date(),
    });
    await tx.insert(filingObligations).values({
      id: obligationId,
      tenant,
      rosterRecordId,
      personId,
      type: 'biennial',
      cycleKey,
      statementDate: `${cycleKey.slice(-4)}-11-01`,
      dueDate,
      status,
      filedAt,
      late,
      policyVersionId: randomUUID(),
      policyVersion: 1,
      reminderOffsetsDays: [30, 14, 7],
    });
  });
  return { obligationId, rosterRecordId };
}

const actingFor = (tenant: string) => ({ headers: { 'x-acting-tenant': tenant } });

interface AuditRead extends Record<string, unknown> {
  action: string;
  resource: { subjectPersonId: string | null; ids?: string[] };
}

async function auditReads(): Promise<AuditRead[]> {
  const rows = await api.asPlatform((tx) => tx.select().from(outbox));
  return rows
    .filter((row) => row.eventType === 'audit.read.v1')
    .map((row) => row.envelope.data as AuditRead);
}

describe('one obligation (spec 08, the ladder)', () => {
  it('gives the obligation with the declarant it falls on, audited', async () => {
    const { obligationId, rosterRecordId } = await givenObligation();

    const response = await api.request(
      'GET',
      `/internal/v1/obligations/${obligationId}`,
      REVIEW,
      actingFor('psc'),
    );

    expect(response.statusCode, response.body).toBe(200);
    const found = response.json<InternalObligation>();
    expect(contractErrors(okResponse(OBLIGATION, 'get'), found)).toEqual([]);
    expect(found).toEqual({
      obligationId,
      rosterRecordId,
      personId: MARY,
      type: 'biennial',
      cycleKey: 'biennial:2025',
      dueDate: '2025-12-31',
      status: 'overdue',
      declarantName: 'Mary Wambui',
      personnelFileNumber: 'PSC/0077',
    });
    expect((await auditReads()).map((read) => read.action)).toContain('obligation.pulled');
  });

  it("is 404 for another Commission's or an unknown obligation, and refuses user tokens", async () => {
    const { obligationId } = await givenObligation({ tenant: 'tsc' });
    const url = `/internal/v1/obligations/${obligationId}`;

    expect((await api.request('GET', url, REVIEW, actingFor('psc'))).statusCode).toBe(404);
    expect(
      (
        await api.request(
          'GET',
          `/internal/v1/obligations/${randomUUID()}`,
          REVIEW,
          actingFor('psc'),
        )
      ).statusCode,
    ).toBe(404);
    expect((await api.request('GET', url, OFFICER, actingFor('tsc'))).statusCode).toBe(403);
  });
});

describe("a person's obligation history (S16, the referral sweep)", () => {
  it('gives per-cycle statuses, oldest first, for a person with two unfiled biennials, audited', async () => {
    const { obligationId: earlier } = await givenObligation();
    const { obligationId: later } = await givenObligation({
      cycleKey: 'biennial:2027',
      dueDate: '2027-12-31',
    });
    const filedAt = new Date('2023-12-01T09:00:00.000Z');
    const { obligationId: filed } = await givenObligation({
      cycleKey: 'biennial:2023',
      dueDate: '2023-12-31',
      status: 'filed',
      filedAt,
    });

    const response = await api.request(
      'GET',
      `/internal/v1/persons/${MARY}/obligations`,
      REVIEW,
      actingFor('psc'),
    );

    expect(response.statusCode, response.body).toBe(200);
    const history = response.json<InternalPersonObligation[]>();
    expect(contractErrors(okResponse(HISTORY, 'get'), history)).toEqual([]);
    expect(history.map((entry) => [entry.obligationId, entry.status, entry.filedAt])).toEqual([
      [filed, 'filed', filedAt.toISOString()],
      [earlier, 'overdue', null],
      [later, 'overdue', null],
    ]);
    expect(await auditReads()).toContainEqual(
      expect.objectContaining({
        action: 'obligation.history.pulled',
        resource: expect.objectContaining({ subjectPersonId: MARY }) as unknown,
      }),
    );
  });

  it('is 404 at another Commission and for an unknown person; no names in it', async () => {
    await givenObligation({ tenant: 'tsc' });

    const elsewhere = await api.request(
      'GET',
      `/internal/v1/persons/${MARY}/obligations`,
      REVIEW,
      actingFor('psc'),
    );
    const there = await api.request(
      'GET',
      `/internal/v1/persons/${MARY}/obligations`,
      REVIEW,
      actingFor('tsc'),
    );

    expect(elsewhere.statusCode).toBe(404);
    expect(there.statusCode).toBe(200);
    expect(there.body).not.toContain('Mary');
  });
});

describe('officer details of a batch of obligations (spec 09, Form M)', () => {
  it('gives the officer of each of the Commission obligations, leaving out the others, audited', async () => {
    const { obligationId: mine } = await givenObligation();
    const { obligationId: exited } = await givenObligation({
      personId: null,
      designation: null,
      exitDate: '2026-03-31',
    });
    const { obligationId: theirs } = await givenObligation({ tenant: 'tsc' });

    const response = await api.request('POST', DETAILS, REPORTING, {
      ...actingFor('psc'),
      body: { obligationIds: [mine, exited, theirs, randomUUID()] },
    });

    expect(response.statusCode, response.body).toBe(200);
    const details = response.json<InternalObligationDetails>();
    expect(contractErrors(responseBody(DETAILS, 'post', 200), details)).toEqual([]);
    expect([...details.items].sort((a, b) => a.obligationId.localeCompare(b.obligationId))).toEqual(
      [
        {
          obligationId: mine,
          name: 'Mary Wambui',
          designation: 'Senior Accountant',
          fileNumber: 'PSC/0077',
          appointmentDate: '2015-01-05',
          exitDate: null,
        },
        {
          obligationId: exited,
          name: 'Mary Wambui',
          designation: '',
          fileNumber: 'PSC/0077',
          appointmentDate: '2015-01-05',
          exitDate: '2026-03-31',
        },
      ].sort((a, b) => a.obligationId.localeCompare(b.obligationId)),
    );
    // The trail names the obligations read, not the ids asked for.
    const audited = (await auditReads()).find(
      (read) => read.action === 'obligation.officers.pulled',
    );
    expect([...(audited?.resource.ids ?? [])].sort()).toEqual([mine, exited].sort());
  });

  it('takes 1 to 1,000 ids, and refuses user tokens', async () => {
    const ids = (count: number) => Array.from({ length: count }, () => randomUUID());

    for (const obligationIds of [[], ids(1_001), ['not-a-uuid']]) {
      const response = await api.request('POST', DETAILS, REPORTING, {
        ...actingFor('psc'),
        body: { obligationIds },
      });
      expect(response.statusCode).toBe(400);
    }
    const thousand = await api.request('POST', DETAILS, REPORTING, {
      ...actingFor('psc'),
      body: { obligationIds: ids(1_000) },
    });
    expect(thousand.statusCode).toBe(200);
    const user = await api.request('POST', DETAILS, OFFICER, {
      ...actingFor('psc'),
      body: { obligationIds: ids(1) },
    });
    expect(user.statusCode).toBe(403);
  });
});
