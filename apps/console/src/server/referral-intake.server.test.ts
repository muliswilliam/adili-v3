import { EACC_ANALYST, EACC_SUPERVISOR, SUPERVISOR } from '@adili/roles';
import { beforeEach, describe, expect, it } from 'vitest';

import createClient from 'openapi-fetch';

import type { paths as DocumentsPaths } from './documents/api.gen';
import { unsignedMockToken } from './mock-http';
import { intakePackageLink, listReferralIntake, pushToIcms } from './referral-intake.server';
import { mockReportingClient } from './reporting/mock.server';
import {
  MOCK_INTAKE_IDS as R,
  MOCK_INTAKE_SIZE,
  mockIntakePackageFetch,
  resetReferralIntakeMock,
} from './reporting/referral-intake-mock.server';

const NOW_MS = Date.parse('2026-10-03T09:00:00Z');

const analyst = () => mockReportingClient('Brian Otieno', [EACC_ANALYST]);

beforeEach(() => {
  resetReferralIntakeMock(NOW_MS);
});

describe('listReferralIntake (S12)', () => {
  it('lists the referrals Commissions sent, the latest first, with their package and ICMS status', async () => {
    const result = await listReferralIntake(analyst(), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(MOCK_INTAKE_SIZE);
    expect(result.data.nextCursor).toBeNull();
    expect(result.data.items[0]).toMatchObject({
      referralId: R.notPushed,
      reference: 'RFL-PSC-2026-0000003-7',
      commission: { slug: 'psc', name: 'Public Service Commission' },
      grounds: 'two-missed-cycles',
      icmsStatus: 'not-pushed',
      icmsCaseNumber: null,
      packageDocumentId: expect.any(String) as string,
    });
  });

  it('filters by ICMS status and pages with the cursor', async () => {
    const failed = await listReferralIntake(analyst(), { icmsStatus: 'push-failed' });
    expect(failed).toMatchObject({
      ok: true,
      data: { items: [{ referralId: R.failed, error: 'icms-unavailable' }], nextCursor: null },
    });
    const first = await listReferralIntake(analyst(), { limit: 20 });
    if (!first.ok) throw new Error('no first page');
    expect(first.data.items).toHaveLength(20);
    const second = await listReferralIntake(analyst(), {
      limit: 20,
      cursor: first.data.nextCursor ?? undefined,
    });
    if (!second.ok) throw new Error('no second page');
    expect(second.data.items).toHaveLength(MOCK_INTAKE_SIZE - 20);
    expect(second.data.nextCursor).toBeNull();
  });

  it('opens to EACC supervisors too, and refuses a Commission supervisor (403)', async () => {
    const eaccSupervisor = await listReferralIntake(
      mockReportingClient('Esther Chebet', [EACC_SUPERVISOR]),
      {},
    );
    expect(eaccSupervisor.ok).toBe(true);
    const commission = await listReferralIntake(
      mockReportingClient('Samuel Njoroge', [SUPERVISOR]),
      {},
    );
    expect(commission).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });
});

const KEY = 'c3d4e5f6-0000-4000-8000-000000000001';
const KEY_2 = 'c3d4e5f6-0000-4000-8000-000000000002';

describe('pushToIcms (S12)', () => {
  it('registers the referral in ICMS and stores the case number, recording who pushed it', async () => {
    const result = await pushToIcms(analyst(), R.notPushed, KEY);
    expect(result).toMatchObject({
      ok: true,
      data: {
        referralId: R.notPushed,
        icmsStatus: 'registered',
        icmsCaseNumber: expect.stringMatching(/^ICMS-2026-\d{6}$/) as string,
        icmsRegisteredAt: new Date(NOW_MS).toISOString(),
        pushedAt: new Date(NOW_MS).toISOString(),
        pushedBy: { name: 'Brian Otieno' },
        error: null,
      },
    });
  });

  it('is idempotent: the same key replays, a registered referral is never sent again', async () => {
    const first = await pushToIcms(analyst(), R.notPushed, KEY);
    const replay = await pushToIcms(analyst(), R.notPushed, KEY);
    const again = await pushToIcms(analyst(), R.notPushed, KEY_2);
    if (!first.ok) throw new Error('not registered');
    expect(replay).toEqual(first);
    expect(again).toMatchObject({
      ok: true,
      data: { icmsCaseNumber: first.data.icmsCaseNumber },
    });
  });

  it('leaves the referral push-failed with why when ICMS is down, and a retry registers it', async () => {
    const failed = await pushToIcms(analyst(), R.failsFirst, KEY);
    expect(failed).toEqual({ ok: false, pushFailed: 'icms-unavailable' });
    const listed = await listReferralIntake(analyst(), { icmsStatus: 'push-failed' });
    if (!listed.ok) throw new Error('no intake');
    expect(listed.data.items.find((each) => each.referralId === R.failsFirst)).toMatchObject({
      icmsStatus: 'push-failed',
      error: 'icms-unavailable',
      pushedBy: { name: 'Brian Otieno' },
    });
    const retried = await pushToIcms(analyst(), R.failsFirst, KEY_2);
    expect(retried).toMatchObject({ ok: true, data: { icmsStatus: 'registered', error: null } });
  });

  it('answers any other refusal as a plain failure: not in the intake, not EACC', async () => {
    const missing = await pushToIcms(analyst(), 'eacc0000-0000-4000-8000-0000000fffff', KEY);
    expect(missing).toMatchObject({
      ok: false,
      pushFailed: null,
      error: { kind: 'problem', problem: { status: 404 } },
    });
    const commission = await pushToIcms(
      mockReportingClient('Samuel Njoroge', [SUPERVISOR]),
      R.notPushed,
      KEY,
    );
    expect(commission).toMatchObject({
      ok: false,
      pushFailed: null,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });
});

const documents = (roles: readonly string[]) =>
  createClient<DocumentsPaths>({
    baseUrl: 'http://documents.test',
    headers: {
      authorization: `Bearer ${unsignedMockToken({ subject: 'mock-officer', name: 'Officer', roles })}`,
    },
    fetch: mockIntakePackageFetch,
  });

describe('intakePackageLink (S12)', () => {
  it('hands an EACC analyst a short-lived link to the Confidential package', async () => {
    const listed = await listReferralIntake(analyst(), {});
    if (!listed.ok) throw new Error('no intake');
    const packageId = listed.data.items[0]?.packageDocumentId ?? '';
    const link = await intakePackageLink(documents([EACC_ANALYST]), packageId);
    expect(link).toEqual({ ok: true, data: { downloadUrl: `/api/mock-files/${packageId}` } });
    const refused = await intakePackageLink(documents([SUPERVISOR]), packageId);
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });
});
