import {
  type Agency,
  callDirectory,
  type DirectoryClient,
  type DirectoryResult,
  type LeaOfficerAccount,
  type LeaOfficerState,
  type ProvisionAgencyOfficer,
} from './directory/client';

/**
 * The directory's law enforcement accounts (spec 10 FE-6, S11) for platform administrators:
 * the agencies (reference data), the officers provisioned for each, provisioning and revoking.
 * Pure: the caller injects the client (`lea-accounts.ts` makes it for the signed-in admin).
 */

export type OfficerCounts = Record<LeaOfficerState, number>;

export interface AgencyRow extends Agency {
  /** Officers by account state; null when the agency's officers could not be read. */
  counts: OfficerCounts | null;
}

export function countOfficers(officers: readonly LeaOfficerAccount[]): OfficerCounts {
  const counts: OfficerCounts = { invited: 0, activated: 0, revoked: 0 };
  for (const officer of officers) counts[officer.state] += 1;
  return counts;
}

/**
 * The agencies in display order, each with its officers counted by state. The directory has no
 * count endpoint; agencies are a handful of seeded rows, so their officers are read side by side.
 */
export async function loadAgencies(client: DirectoryClient): Promise<DirectoryResult<AgencyRow[]>> {
  const agencies = await callDirectory(() => client.GET('/v1/law-enforcement/agencies'));
  if (!agencies.ok) return agencies;
  const rows = await Promise.all(
    agencies.data.map(async (agency): Promise<AgencyRow> => {
      const officers = await loadOfficers(client, agency.code);
      return { ...agency, counts: officers.ok ? countOfficers(officers.data) : null };
    }),
  );
  return { ok: true, data: rows };
}

export function loadOfficers(
  client: DirectoryClient,
  code: string,
): Promise<DirectoryResult<LeaOfficerAccount[]>> {
  return callDirectory(() =>
    client.GET('/v1/law-enforcement/agencies/{code}/officers', { params: { path: { code } } }),
  );
}

export interface AgencyOfficers {
  agency: Agency;
  officers: LeaOfficerAccount[];
  /** Every agency, for the provision dialog's choice. */
  agencies: Agency[];
}

/** One agency and every officer ever provisioned for it, by name; 404 problem for an unknown code. */
export async function loadAgencyOfficers(
  client: DirectoryClient,
  code: string,
): Promise<DirectoryResult<AgencyOfficers>> {
  const [agencies, officers] = await Promise.all([
    callDirectory(() => client.GET('/v1/law-enforcement/agencies')),
    loadOfficers(client, code),
  ]);
  if (!agencies.ok) return agencies;
  if (!officers.ok) return officers;
  const agency = agencies.data.find((each) => each.code === code);
  if (!agency) {
    return {
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'about:blank', title: 'No agency has this code', status: 404 },
      },
    };
  }
  return { ok: true, data: { agency, officers: officers.data, agencies: agencies.data } };
}

/** `POST .../officers` with the dialog's Idempotency-Key: one activation email. */
export function provisionOfficer(
  client: DirectoryClient,
  code: string,
  officer: ProvisionAgencyOfficer,
  idempotencyKey: string,
): Promise<DirectoryResult<LeaOfficerAccount>> {
  return callDirectory(() =>
    client.POST('/v1/law-enforcement/agencies/{code}/officers', {
      params: { path: { code }, header: { 'Idempotency-Key': idempotencyKey } },
      body: officer,
    }),
  );
}

/** `POST .../revoke`: disables the account; revoking again changes nothing. */
export function revokeOfficer(
  client: DirectoryClient,
  officerId: string,
): Promise<DirectoryResult<LeaOfficerAccount>> {
  return callDirectory(() =>
    client.POST('/v1/law-enforcement/officers/{officerId}/revoke', {
      params: { path: { officerId } },
    }),
  );
}
