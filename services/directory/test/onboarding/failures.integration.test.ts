import { withTenant } from '@adili/data-access';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { onboardingFailures } from '../../src/db/schema.js';
import type { OnboardingFailuresView } from '../../src/onboarding/failures/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { givenRoster, givenSession, identify, onSession } from '../support/onboarding.js';

/**
 * Spec 03 story 30 over HTTP: a reporting officer reads how many onboarding attempts failed
 * against their Commission in the last 24 hours (identify's no-match, and sessions that ran out
 * of codes), by hour, without identifiers.
 */

const NOW = new Date('2026-10-01T09:20:00Z');
const HOUR = 60 * 60 * 1000;
const PATH = '/v1/commissions/{slug}/roster/onboarding-failures';
const TSC_OFFICER: Caller = { tenant: 'tsc', roles: ['reporting-officer'] };
const PSC_OFFICER: Caller = { tenant: 'psc', roles: ['reporting-officer'] };
const PLATFORM_ADMIN: Caller = { tenant: 'platform', roles: ['platform-admin'] };

const WANJIRU = {
  personnelFileNumber: 'TSC/100200',
  fullName: 'Wanjiru Achieng Otieno',
  nationalId: '12345678',
  email: 'wanjiru.otieno@tsc.go.ke',
  phone: '+254712345123',
};

let api: DirectoryApi;
let recordId: string;

const failuresOf = (slug: string, caller: Caller) =>
  api.get(`/v1/commissions/${slug}/roster/onboarding-failures`, caller);

beforeAll(async () => {
  api = await startDirectoryApi();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  await givenCommissions(api.db, [
    { slug: 'tsc', name: 'Teachers Service Commission' },
    { slug: 'psc', name: 'Public Service Commission' },
  ]);
  recordId = (await givenRoster(api, 'tsc', [WANJIRU])).get(WANJIRU.personnelFileNumber) ?? '';
});

afterAll(async () => {
  await api.close();
});

describe('GET /v1/commissions/{slug}/roster/onboarding-failures (story 30)', () => {
  it('counts no-matches and sessions that ran out of codes, by hour, over the last 24 hours', async () => {
    // Older than 24 hours, and within them.
    await withTenant(api.db, { tenant: 'tsc', subject: 'test' }, (tx) =>
      tx.insert(onboardingFailures).values([
        { tenant: 'tsc', windowStart: new Date('2026-09-30T09:00:00Z'), failures: 40 },
        { tenant: 'tsc', windowStart: new Date('2026-09-30T10:00:00Z'), failures: 3 },
      ]),
    );
    await identify(api, {
      commission: 'tsc',
      personnelFileNumber: 'TSC/1',
      nationalId: '11111111',
    });
    const session = await givenSession(api, {
      recordId,
      state: 'email-pending',
      email: WANJIRU.email,
      phone: WANJIRU.phone,
      otp: { channel: 'email', code: '123456', attempts: 4 },
    });
    await onSession(api, 'POST', session.id, '/otp/email/verify', session.secret, {
      code: '654321',
    });

    const response = await failuresOf('tsc', TSC_OFFICER);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<OnboardingFailuresView>();
    expect(contractErrors(okResponse(PATH, 'get'), body)).toEqual([]);
    expect(body).toEqual({
      since: '2026-09-30T10:00:00.000Z',
      failedAttempts: 5,
      hours: [
        { windowStart: '2026-09-30T10:00:00.000Z', failedAttempts: 3 },
        { windowStart: '2026-10-01T09:00:00.000Z', failedAttempts: 2 },
      ],
    });

    // 23 hours on, only this hour's count is still within the 24.
    api.clock.advance(23 * HOUR);
    expect((await failuresOf('tsc', TSC_OFFICER)).json()).toMatchObject({
      since: '2026-10-01T09:00:00.000Z',
      failedAttempts: 2,
    });
  });

  it("is the Commission's own: 404 for another Commission's officer, every Commission for platform admins", async () => {
    await identify(api, {
      commission: 'tsc',
      personnelFileNumber: 'TSC/1',
      nationalId: '11111111',
    });

    expect((await failuresOf('tsc', PSC_OFFICER)).statusCode).toBe(404);
    expect((await failuresOf('tsc', PLATFORM_ADMIN)).json()).toMatchObject({ failedAttempts: 1 });
    expect((await failuresOf('psc', PLATFORM_ADMIN)).json()).toMatchObject({
      failedAttempts: 0,
      hours: [],
    });
    expect((await failuresOf('kpa', PLATFORM_ADMIN)).statusCode).toBe(404);
  });

  it('is 403 for roles that do not read rosters', async () => {
    const response = await failuresOf('tsc', { tenant: 'tsc', roles: ['declarant'] });

    expect(response.statusCode).toBe(403);
  });
});
