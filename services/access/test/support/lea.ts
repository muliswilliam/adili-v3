import { randomUUID } from 'node:crypto';

import { LAW_ENFORCEMENT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';

import { leaRequests } from '../../src/db/schema.js';
import type { LeaRequest, LeaRequestRow } from '../../src/lea/representation.js';
import type { AccessApi, Caller } from './access-api.js';
import { callers } from './requests.js';

/** Law enforcement officers signed in to the console (tenant `lea`, with their person). */
export const leaCallers = {
  /** Insp. Peter Mwangi of the DCI. */
  peter: {
    sub: 'lea-peter',
    roles: [LAW_ENFORCEMENT],
    tenant: 'lea',
    personId: randomUUID(),
    name: 'Peter Mwangi',
  },
  /** Collins Kiprotich of the ODPP. */
  collins: {
    sub: 'lea-collins',
    roles: [LAW_ENFORCEMENT],
    tenant: 'lea',
    personId: randomUUID(),
    name: 'Collins Kiprotich',
  },
} satisfies Record<string, Caller>;

/** Peter's written request to the PSC about Anne Njeri Mutua. */
export const LEA_INPUT = {
  commission: 'psc',
  officerSought: {
    name: 'Anne Njeri Mutua',
    entity: 'Ministry of Lands and Physical Planning',
    personnelFileNumber: 'PF-2011-004512',
  },
  reason: 'Investigation into irregular allocation of public land in Nairobi.',
  caseReference: 'DCI/ECU/121/2027',
  scope: {
    years: [2026],
    includeSpouses: true,
    includeChildren: false,
    sections: ['income', 'assets'],
    includeClarifications: false,
  },
};

/** Peter (DCI) and Collins (ODPP) as provisioned, activated officers in the directory. */
export function givenLeaOfficers(api: AccessApi): void {
  const { peter, collins } = leaCallers;
  api.directory.givenLeaOfficer(peter.personId, peter.sub, { name: peter.name });
  api.directory.givenLeaOfficer(collins.personId, collins.sub, {
    name: collins.name,
    agency: {
      code: 'ODPP',
      name: 'Office of the Director of Public Prosecutions',
      legalBasis: 'Office of the Director of Public Prosecutions Act, 2013, s.5',
    },
  });
}

/** A law enforcement request, received. */
export async function submitLea(
  api: AccessApi,
  body: unknown = LEA_INPUT,
  caller: Caller = leaCallers.peter,
): Promise<LeaRequest> {
  const response = await submitLeaResponse(api, body, caller);
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

export const submitLeaResponse = (api: AccessApi, body: unknown, caller: Caller) =>
  api.send('POST', '/v1/lea/requests', caller, body, { 'idempotency-key': randomUUID() });

/** The access officer's verification, confirming provenance and reason. */
export const verifyLea = (
  api: AccessApi,
  id: string,
  rosterRecordId: string,
  caller: Caller = callers.officer,
  extra: Record<string, unknown> = {},
) =>
  api.send('POST', `/v1/lea/requests/${id}/verify`, caller, {
    provenanceConfirmed: true,
    reasonConfirmed: true,
    rosterRecordId,
    note: 'Sent from the DCI account of Insp. Peter Mwangi. Reason and case reference stated.',
    ...extra,
  });

/** The access officer's decision, with a fresh Idempotency-Key. */
export const decideLea = (
  api: AccessApi,
  id: string,
  body: unknown,
  caller: Caller = callers.officer,
) =>
  api.send('POST', `/v1/lea/requests/${id}/decision`, caller, body, {
    'idempotency-key': randomUUID(),
  });

/** The request's row, as the service stores it. */
export async function leaRowOf(api: AccessApi, id: string): Promise<LeaRequestRow> {
  const [row] = await api.asPlatform((tx) =>
    tx.select().from(leaRequests).where(eq(leaRequests.id, id)),
  );
  if (!row) throw new Error(`No law enforcement request ${id}`);
  return row;
}
