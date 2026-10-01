import { ACCESS_OFFICER, SUPERVISOR } from '@adili/roles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  attachmentLink,
  loadQueue,
  loadRequest,
  resolveOfficer,
  searchRoster,
  verifyApplicant,
} from './access-requests.server';
import {
  MOCK_REQUEST_IDS as R,
  MOCK_ROSTER_IDS as K,
  mockAccessClient,
  resetAccessMock,
  setAccessMockLatency,
} from './access/mock.server';

const officer = () => mockAccessClient([ACCESS_OFFICER]);
const supervisor = () => mockAccessClient([SUPERVISOR]);
const key = () => crypto.randomUUID();

beforeAll(() => {
  setAccessMockLatency(0);
});
afterAll(() => {
  setAccessMockLatency(1);
});
beforeEach(() => {
  resetAccessMock();
});

async function ids(search: Parameters<typeof loadQueue>[2]): Promise<string[]> {
  const result = await loadQueue(officer(), 'psc', search, 100);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data.items.map((item) => item.id);
}

describe('the queue (S16)', () => {
  it('lists open requests first by earliest deadline, then decided and closed ones', async () => {
    const result = await loadQueue(officer(), 'psc', {}, 100);
    if (!result.ok) throw new Error('not ok');
    const { items } = result.data;
    const firstClosed = items.findIndex((item) =>
      ['granted', 'partially-granted', 'denied', 'cannot-identify', 'withdrawn'].includes(
        item.status,
      ),
    );
    expect(items[0]?.id).toBe(R.late);
    expect(items[0]?.late).toBe(true);
    expect(items.slice(firstClosed).every((item) => item.closedAt !== null)).toBe(true);
    expect(items.slice(0, firstClosed).every((item) => item.closedAt === null)).toBe(true);
  });

  it('pages with the cursor', async () => {
    const first = await loadQueue(officer(), 'psc', {}, 20);
    if (!first.ok || !first.data.nextCursor) throw new Error('no second page');
    const second = await loadQueue(officer(), 'psc', { cursor: first.data.nextCursor }, 20);
    if (!second.ok) throw new Error('not ok');
    expect(second.data.items.length).toBeGreaterThan(0);
    expect(second.data.items.map((item) => item.id)).not.toContain(first.data.items[0]?.id);
  });

  it('filters: needs action, awaiting representations, late, decided, closed, and search', async () => {
    expect(await ids({ filter: 'late' })).toEqual([R.late]);
    expect(await ids({ filter: 'window' })).toEqual([R.window]);
    expect(await ids({ filter: 'closed' })).toEqual([R.withdrawn, R.cannot]);
    expect(await ids({ filter: 'action' })).toEqual(
      expect.arrayContaining([R.verify, R.identify, R.unresolved, R.objection]),
    );
    expect(await ids({ filter: 'action' })).not.toContain(R.window);
    expect(await ids({ filter: 'decided' })).toEqual(expect.arrayContaining([R.granted, R.denied]));
    expect(await ids({ search: 'ARQ-PSC-2026-0000139' })).toEqual([R.objection]);
    expect(await ids({ search: 'KRR/2011' })).toEqual(expect.arrayContaining([R.objection]));
    expect(await ids({ search: 'kwame' })).toEqual([R.verify]);
    expect(await ids({ search: 'Onyango Kisii' })).toEqual([]);
  });

  it('is unavailable when the service is', async () => {
    const result = await loadQueue(officer(), 'psc', { search: 'offline' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});

describe('a request (S3)', () => {
  it('gives the officer view with its Form K, representations and register', async () => {
    const result = await loadRequest(officer(), R.objection);
    if (!result.ok) throw new Error('not ok');
    expect(result.data.formK.partII.personnelFileNumber).toBe('KRR/2011/0442');
    expect(result.data.representations?.stance).toBe('object');
    expect(result.data.resolvedName).toBe('Grace Atieno Odhiambo');
    expect(result.data.timeline.map((entry) => entry.kind)).toContain('notified');
  });

  it('searches the roster, saying which records can be chosen', async () => {
    const result = await searchRoster(officer(), R.identify, 'ouma');
    if (!result.ok) throw new Error('not ok');
    expect(result.data.items.map((each) => [each.fullName, each.onboarded])).toEqual([
      ['Josephine Adhiambo Ouma', false],
      ['Josephine Akinyi Ouma', true],
      ['Peter Omondi Ouma', true],
    ]);
  });

  it('S3: identifies the officer; the declarant is notified next, once only', async () => {
    const resolved = await resolveOfficer(officer(), R.identify, K.josephine, key());
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.error));
    expect(resolved.data).toMatchObject({
      status: 'submitted',
      resolvedName: 'Josephine Akinyi Ouma',
      resolvedFileNumber: '20113458',
    });
    const again = await resolveOfficer(officer(), R.identify, K.josephine, key());
    expect(again).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'officer-resolved' } },
    });
  });

  it('refuses a record that has not onboarded at rosterRecordId', async () => {
    const result = await resolveOfficer(officer(), R.identify, K.josephineAdhiambo, key());
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400, errors: [{ path: 'rosterRecordId' }] } },
    });
  });

  it('S3: closes the request when the officer cannot be identified', async () => {
    const result = await resolveOfficer(officer(), R.unresolved, null, key());
    if (!result.ok) throw new Error('not ok');
    expect(result.data.status).toBe('cannot-identify');
    expect(result.data.timeline.at(-1)?.kind).toBe('cannot-identify');
  });

  it('verifies a passport applicant, releasing the request to be identified', async () => {
    const result = await verifyApplicant(officer(), R.verify, 'Passport seen by email.', key());
    if (!result.ok) throw new Error('not ok');
    expect(result.data).toMatchObject({ status: 'submitted', applicantIdentityStatus: 'verified' });
    const again = await verifyApplicant(officer(), R.verify, 'Again.', key());
    expect(again).toMatchObject({
      ok: false,
      error: { problem: { status: 409, code: 'not-pending-verification' } },
    });
  });

  it('S16: the supervisor reads requests and attachments, but cannot act', async () => {
    expect((await loadRequest(supervisor(), R.objection)).ok).toBe(true);
    const link = await attachmentLink(
      supervisor(),
      R.objection,
      'a11e0000-0000-4000-8000-000000000001',
    );
    expect(link).toMatchObject({
      ok: true,
      data: { downloadUrl: expect.stringContaining('/api/mock-files/') as unknown },
    });
    for (const result of [
      await searchRoster(supervisor(), R.identify, 'ouma'),
      await resolveOfficer(supervisor(), R.identify, K.josephine, key()),
      await verifyApplicant(supervisor(), R.verify, 'Checked.', key()),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { problem: { status: 403 } } });
    }
  });

  it('answers 404 for an attachment not on the representations', async () => {
    const result = await attachmentLink(officer(), R.objection, crypto.randomUUID());
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 404 } } });
  });
});
