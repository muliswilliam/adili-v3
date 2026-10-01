import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { ACCESS_OFFICER, APPLICANT, DECLARANT, EACC_ANALYST, SUPERVISOR } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';

import { accessRequests } from '../../src/db/schema.js';
import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import type { AccessRequestRow } from '../../src/requests/representation.js';
import type { AccessApi, Caller } from './access-api.js';

const fixtures = createRequire(import.meta.url);

/** Mercy Wanjiku Kamau's Form K to the PSC about Anne Njeri Mutua (national ID applicant). */
export const COMPLETE = JSON.parse(
  readFileSync(
    fixtures.resolve('@adili/schemas/forms/fixtures/form-k.v1/valid/complete.json'),
    'utf8',
  ),
) as Record<string, unknown>;

/** The callers of the officer-side and declarant-side suites. */
export const callers = {
  mercy: {
    sub: 'applicant-mercy',
    roles: [APPLICANT],
    personId: randomUUID(),
    name: 'Mercy Wanjiku Kamau',
  },
  officer: { sub: 'officer-psc', roles: [ACCESS_OFFICER], tenant: 'psc', name: 'Peter Access' },
  supervisor: { sub: 'supervisor-psc', roles: [SUPERVISOR], tenant: 'psc', name: 'Sara Super' },
  tscOfficer: { sub: 'officer-tsc', roles: [ACCESS_OFFICER], tenant: 'tsc', name: 'Tom Teachers' },
  eacc: { sub: 'analyst-eacc', roles: [EACC_ANALYST], tenant: 'eacc' },
} satisfies Record<string, Caller>;

/** The declarant a roster record is onboarded as, signed in to the portal. */
export function declarantOf(record: RosterCandidateFacts): Caller {
  if (record.personId === null) throw new Error('The record is not onboarded');
  return {
    sub: `declarant-${record.id}`,
    roles: [DECLARANT],
    tenant: 'psc',
    personId: record.personId,
  };
}

/** The PSC and TSC, Mercy a verified applicant, and Anne Njeri Mutua onboarded on the PSC roster. */
export function givenCommissions(api: AccessApi, now: string): { anne: RosterCandidateFacts } {
  api.directory.givenCommission('psc', 'Public Service Commission');
  api.directory.givenCommission('tsc', 'Teachers Service Commission');
  api.directory.givenApplicant(callers.mercy.personId);
  api.clock.set(now);
  const anne = api.directory.givenRosterRecord('psc', {
    personnelFileNumber: 'PF-2011-004512',
    fullName: 'Anne Njeri Mutua',
    designation: 'Deputy Director, Land Administration',
    reportingEntityName: 'Ministry of Lands and Physical Planning',
  });
  return { anne };
}

/** Mercy's Form K, received. */
export async function submitRequest(
  api: AccessApi,
  body: unknown = COMPLETE,
  caller: Caller = callers.mercy,
): Promise<{ id: string; reference: string; status: string }> {
  const response = await api.send('POST', '/v1/access/requests', caller, body, {
    'idempotency-key': randomUUID(),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

export const resolve = (
  api: AccessApi,
  requestId: string,
  rosterRecordId: string | null,
  caller: Caller = callers.officer,
) => api.send('POST', `/v1/access/requests/${requestId}/resolve`, caller, { rosterRecordId });

/** The request's row, as the service stores it. */
export async function rowOf(api: AccessApi, id: string): Promise<AccessRequestRow> {
  const [row] = await api.asPlatform((tx) =>
    tx.select().from(accessRequests).where(eq(accessRequests.id, id)),
  );
  if (!row) throw new Error(`No request ${id}`);
  return row;
}

/** Waits until the workflow has notified the declarant of the request. */
export function untilNotified(api: AccessApi, id: string): Promise<AccessRequestRow> {
  return api.eventually(async () => {
    const row = await rowOf(api, id);
    return row.notifiedAt === null ? undefined : row;
  });
}

/** The access officer's decision on a request, with a fresh Idempotency-Key. */
export const decide = (
  api: AccessApi,
  requestId: string,
  body: unknown,
  caller: Caller = callers.officer,
) =>
  api.send('POST', `/v1/access/requests/${requestId}/decision`, caller, body, {
    'idempotency-key': randomUUID(),
  });

/** Mercy's request about Anne, notified to her and under decision: Anne consented. */
export async function underDecisionRequest(
  api: AccessApi,
  anne: RosterCandidateFacts,
): Promise<AccessRequestRow> {
  const notified = await notifiedRequest(api, anne);
  const consented = await api.send(
    'PUT',
    `/v1/me/access-notices/${notified.id}/representations`,
    declarantOf(anne),
    { stance: 'consent', text: '', attachments: [] },
  );
  expect(consented.statusCode, consented.body).toBe(200);
  return rowOf(api, notified.id);
}

/** Mercy's request, resolved to Anne and notified to her by the workflow. */
export async function notifiedRequest(
  api: AccessApi,
  anne: RosterCandidateFacts,
): Promise<AccessRequestRow> {
  const { id } = await submitRequest(api);
  const resolved = await resolve(api, id, anne.id);
  expect(resolved.statusCode, resolved.body).toBe(200);
  return untilNotified(api, id);
}
