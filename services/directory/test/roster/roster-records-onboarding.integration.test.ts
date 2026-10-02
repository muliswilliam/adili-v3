import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { RosterRecord, RosterRecordPage } from '../../src/roster/records/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import {
  givenIdentityMismatch,
  givenOnboardedPerson,
  givenRoster,
  type OnboardedPerson,
} from '../support/onboarding.js';

/**
 * Spec 03 S25 over HTTP: onboarding on the roster records a reporting officer reads. The list
 * filters records on which IPRS refused an onboarding (`identityMismatch`), and records show
 * the declarant's OFR and when they onboarded, and when a mismatch was found.
 */

const NOW = new Date('2026-10-01T09:00:00Z');
const MISMATCH_AT = new Date('2026-09-24T11:20:00Z');
const LIST_PATH = '/v1/commissions/{slug}/roster/records';
const RECORD_PATH = '/v1/commissions/{slug}/roster/records/{recordId}';
const records = (slug: string, query = '') => `/v1/commissions/${slug}/roster/records${query}`;

const TSC_OFFICER: Caller = { sub: 'officer-tsc', tenant: 'tsc', roles: ['reporting-officer'] };
const PSC_OFFICER: Caller = { sub: 'officer-psc', tenant: 'psc', roles: ['reporting-officer'] };
const PLATFORM_ADMIN: Caller = { tenant: 'platform', roles: ['platform-admin'] };

let api: DirectoryApi;
let ids: Map<string, string>;
let onboarded: OnboardedPerson;

const byFileNumber = (page: RosterRecordPage) => page.items.map((item) => item.personnelFileNumber);

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  await givenCommissions(api.db, [
    { slug: 'tsc', name: 'Teachers Service Commission' },
    { slug: 'psc', name: 'Public Service Commission' },
  ]);
  ids = await givenRoster(api, 'tsc', [
    { personnelFileNumber: 'TSC/1', fullName: 'Achieng Otieno', nationalId: '11223344' },
    { personnelFileNumber: 'TSC/2', fullName: 'Baraka Mwangi', nationalId: '22334455' },
    { personnelFileNumber: 'TSC/3', fullName: 'Chebet Rotich', nationalId: '33445566' },
  ]);
  const psc = await givenRoster(api, 'psc', [
    { personnelFileNumber: 'PSC/1', fullName: 'Daudi Kiprop', nationalId: '44556677' },
  ]);
  onboarded = await givenOnboardedPerson(api, { recordIds: [ids.get('TSC/1') ?? ''] });
  await givenIdentityMismatch(api, ids.get('TSC/2') ?? '', MISMATCH_AT);
  await givenIdentityMismatch(api, psc.get('PSC/1') ?? '', MISMATCH_AT);
});

describe('roster records and onboarding (S25)', () => {
  it('filters records with an identity mismatch for the reporting officer, own Commission only', async () => {
    const response = await api.get(records('tsc', '?identityMismatch=true'), TSC_OFFICER);

    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<RosterRecordPage>();
    expect(contractErrors(okResponse(LIST_PATH, 'get'), page)).toEqual([]);
    expect(byFileNumber(page)).toEqual(['TSC/2']);
    expect(page.items[0]).toMatchObject({
      state: 'not_onboarded',
      identityMismatchAt: MISMATCH_AT.toISOString(),
      ofr: null,
      onboardedAt: null,
    });
  });

  it('filters the records without one, and combines with the other filters', async () => {
    const without = await api.get(records('tsc', '?identityMismatch=false'), TSC_OFFICER);
    expect(byFileNumber(without.json<RosterRecordPage>())).toEqual(['TSC/1', 'TSC/3']);

    const onboardedOnly = await api.get(
      records('tsc', '?identityMismatch=false&state=onboarded'),
      TSC_OFFICER,
    );
    expect(byFileNumber(onboardedOnly.json<RosterRecordPage>())).toEqual(['TSC/1']);
  });

  it('gives platform admins the filter on every Commission', async () => {
    for (const [slug, expected] of [
      ['tsc', ['TSC/2']],
      ['psc', ['PSC/1']],
    ] as const) {
      const response = await api.get(records(slug, '?identityMismatch=true'), PLATFORM_ADMIN);
      expect(response.statusCode, response.body).toBe(200);
      expect(byFileNumber(response.json<RosterRecordPage>())).toEqual(expected);
    }
  });

  it("does not let a reporting officer filter another Commission's records", async () => {
    const response = await api.get(records('tsc', '?identityMismatch=true'), PSC_OFFICER);
    expect(response.statusCode).toBe(404);
  });

  it('rejects a filter value other than true or false', async () => {
    const response = await api.get(records('tsc', '?identityMismatch=yes'), TSC_OFFICER);
    expect(response.statusCode).toBe(400);
  });

  it('shows the OFR and when the declarant onboarded on the list and the record', async () => {
    const list = await api.get(records('tsc'), TSC_OFFICER);
    const item = list.json<RosterRecordPage>().items.find((i) => i.personnelFileNumber === 'TSC/1');
    expect(item).toMatchObject({
      state: 'onboarded',
      ofr: onboarded.ofr,
      onboardedAt: NOW.toISOString(),
      identityMismatchAt: null,
    });

    const response = await api.get(records('tsc', `/${ids.get('TSC/1')}`), TSC_OFFICER);

    expect(response.statusCode, response.body).toBe(200);
    const record = response.json<RosterRecord>();
    expect(contractErrors(okResponse(RECORD_PATH, 'get'), record)).toEqual([]);
    expect(record).toMatchObject({
      state: 'onboarded',
      ofr: onboarded.ofr,
      onboardedAt: NOW.toISOString(),
      identityMismatchAt: null,
    });
  });

  it('shows when a mismatch was found on the record', async () => {
    const response = await api.get(records('tsc', `/${ids.get('TSC/2')}`), TSC_OFFICER);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<RosterRecord>()).toMatchObject({
      ofr: null,
      onboardedAt: null,
      identityMismatchAt: MISMATCH_AT.toISOString(),
    });
  });
});
