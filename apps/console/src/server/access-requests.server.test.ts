import { ACCESS_OFFICER, SUPERVISOR } from '@adili/roles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  asOfficerView,
  attachmentLink,
  decideRequest,
  enterRepresentations,
  loadQueue,
  loadRequest,
  recordWrittenNotice,
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
import { MOCK_LEA_IDS as L } from './access/lea-mock.server';

const officer = () => mockAccessClient([ACCESS_OFFICER]);
const supervisor = () => mockAccessClient([SUPERVISOR]);
const key = () => crypto.randomUUID();
const todayInNairobi = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());

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
    expect(await ids({ kind: 'form-k', filter: 'late' })).toEqual([R.late, R.lateWindow]);
    expect(await ids({ filter: 'window' })).toEqual([R.lateWindow, R.writtenNotice, R.window]);
    expect(await ids({ kind: 'form-k', filter: 'closed' })).toEqual([R.withdrawn, R.cannot]);
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

  it('S11: shows law enforcement requests among Form K ones, and on their own tab', async () => {
    const all = await ids({});
    expect(all).toEqual(expect.arrayContaining([R.late, L.received, L.breach, L.verified]));
    // Not another Commission's.
    expect(all).not.toContain(L.tsc);
    expect(await ids({ filter: 'late' })).toEqual([R.late, R.lateWindow, L.breach]);
    const lea = await loadQueue(officer(), 'psc', { kind: 'lea' }, 100);
    if (!lea.ok) throw new Error('not ok');
    expect(lea.data.items.every((item) => item.kind === 'lea')).toBe(true);
    expect(lea.data.items[0]).toMatchObject({
      id: L.breach,
      applicantOrAgency: 'Office of the Director of Public Prosecutions',
      status: 'received',
      late: true,
      windowEndsAt: null,
    });
    expect(await ids({ kind: 'lea', filter: 'action' })).toEqual([
      L.breach,
      L.soon,
      L.verified,
      L.received,
    ]);
    expect(await ids({ kind: 'form-k' })).not.toContain(L.received);
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

  it('reads the Form K as form-k.v1 at the client boundary, and a drifted one as unavailable', async () => {
    const loaded = await loadRequest(officer(), R.objection);
    if (!loaded.ok) throw new Error('not ok');
    const view = { ...loaded.data, formK: { ...loaded.data.formK, partII: { surname: 1 } } };
    const drifted = await asOfficerView(Promise.resolve({ ok: true, data: view }));
    expect(drifted).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
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

  it('decision 2: identifies a record that has not onboarded, to be served in writing', async () => {
    const result = await resolveOfficer(officer(), R.identify, K.josephineAdhiambo, key());
    if (!result.ok) throw new Error('not ok');
    expect(result.data).toMatchObject({
      status: 'submitted',
      resolvedRosterRecordId: K.josephineAdhiambo,
      declarantOnboarded: false,
      declarantInvitedAt: expect.any(String) as unknown,
      notice: null,
    });
  });

  it('decision 2: records the written notice, then representations received in writing', async () => {
    const served = await recordWrittenNotice(officer(), R.noAccount, todayInNairobi(), key());
    if (!served.ok) throw new Error('not ok');
    expect(served.data).toMatchObject({
      status: 'awaiting-representations',
      notice: { channel: 'written', notifiedOn: todayInNairobi(), recordedBy: 'Lucy Wambui' },
    });
    expect(served.data.timeline.at(-1)).toMatchObject({ kind: 'notified', inWriting: true });
    const again = await recordWrittenNotice(officer(), R.noAccount, todayInNairobi(), key());
    expect(again).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'declarant-notified' } },
    });

    const entered = await enterRepresentations(
      officer(),
      R.noAccount,
      { stance: 'context', text: 'From the letter.', attachments: [] },
      key(),
    );
    if (!entered.ok) throw new Error('not ok');
    expect(entered.data.representations).toMatchObject({
      stance: 'context',
      receivedInWriting: true,
      recordedBy: 'Lucy Wambui',
    });
    // Notified online: the declarant makes their own.
    const online = await enterRepresentations(
      officer(),
      R.window,
      { stance: 'context', text: 'x', attachments: [] },
      key(),
    );
    expect(online).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409 } },
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

describe('the decision (S6, #260)', () => {
  const narrower = {
    years: [2026],
    includeSpouses: true,
    includeChildren: false,
    sections: ['income' as const],
  };

  it('records a partial grant of a narrower scope; the package follows', async () => {
    const result = await decideRequest(
      officer(),
      R.objection,
      {
        outcome: 'partial-grant',
        grantedScope: narrower,
        grounds: ['public-interest'],
        reasons: 'Narrowed.',
      },
      key(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.status).toBe('partially-granted');
    expect(result.data.decision).toMatchObject({
      grantedScope: narrower,
      grounds: ['public-interest'],
    });
    expect(result.data.package).toBeNull();
    expect(result.data.timeline.at(-1)?.kind).toBe('decided');
  });

  it('refuses a denial without grounds (400 grounds-required) and a second decision (409)', async () => {
    const bare = await decideRequest(
      officer(),
      R.objection,
      { outcome: 'deny', reasons: 'No.' },
      key(),
    );
    expect(bare).toMatchObject({
      ok: false,
      error: { problem: { status: 400, code: 'grounds-required', errors: [{ path: 'grounds' }] } },
    });
    const deny = {
      outcome: 'deny' as const,
      grounds: ['frivolous-vexatious' as const],
      reasons: 'No.',
    };
    expect((await decideRequest(officer(), R.objection, deny, key())).ok).toBe(true);
    expect(await decideRequest(officer(), R.objection, deny, key())).toMatchObject({
      ok: false,
      error: { problem: { status: 409, code: 'request-decided' } },
    });
  });

  it('refuses a scope wider than requested, and a decision before the window closed', async () => {
    const wider = await decideRequest(
      officer(),
      R.objection,
      {
        outcome: 'partial-grant',
        grantedScope: { ...narrower, sections: ['assets'] },
        grounds: ['public-interest'],
        reasons: 'Wider.',
      },
      key(),
    );
    expect(wider).toMatchObject({
      ok: false,
      error: { problem: { status: 400, code: 'scope-exceeds-request' } },
    });
    const early = await decideRequest(
      officer(),
      R.window,
      { outcome: 'grant', reasons: 'Early.' },
      key(),
    );
    expect(early).toMatchObject({
      ok: false,
      error: { problem: { status: 409, code: 'not-under-decision' } },
    });
  });

  it('is for the access officer only: the supervisor gets 403', async () => {
    const result = await decideRequest(
      supervisor(),
      R.objection,
      { outcome: 'grant', reasons: 'Yes.' },
      key(),
    );
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 403 } } });
  });
});
