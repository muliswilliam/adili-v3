import { ACCESS_OFFICER, LAW_ENFORCEMENT, SUPERVISOR } from '@adili/roles';
import createClient from 'openapi-fetch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MOCK_LEA_IDS as L, mockPackageFetch } from './access/lea-mock.server';
import { mockAccessClient, resetAccessMock, setAccessMockLatency } from './access/mock.server';
import { MOCK_ROSTER_IDS as K } from './access/mock-roster';
import { mockToken } from './access/mock-caller';
import type { LeaRequestInput } from './access/types';
import type { paths as DocumentsPaths } from './documents/api.gen';
import {
  decideLeaRequest,
  listMyLeaRequests,
  listRequestCommissions,
  loadLeaRequest,
  packageDownload,
  searchLeaRoster,
  submitLeaRequest,
  verifyLeaRequest,
} from './lea-requests.server';

const officer = () => mockAccessClient([ACCESS_OFFICER]);
const supervisor = () => mockAccessClient([SUPERVISOR]);
const lea = () => mockAccessClient([LAW_ENFORCEMENT], 'Suleiman Ali');
const documents = () =>
  createClient<DocumentsPaths>({
    baseUrl: 'http://documents.test',
    headers: {
      authorization: `Bearer ${mockToken('lea-1', 'Suleiman Ali', [LAW_ENFORCEMENT])}`,
    },
    fetch: mockPackageFetch,
  });
const key = () => crypto.randomUUID();

const VERIFY = {
  provenanceConfirmed: true as const,
  reasonConfirmed: true as const,
  rosterRecordId: K.grace,
  note: 'Sent from the DCI account. Reason and case reference stated.',
};

const INPUT: LeaRequestInput = {
  commission: 'psc',
  officerSought: { name: 'Grace Nyambura Kamau', personnelFileNumber: '20107725' },
  reason: 'Investigation into the award of housing tenders.',
  caseReference: 'DCI/ECU/150/2026',
  scope: {
    years: [2026],
    includeSpouses: false,
    includeChildren: false,
    sections: ['assets'],
  },
};

beforeAll(() => {
  setAccessMockLatency(0);
});
afterAll(() => {
  setAccessMockLatency(1);
});
beforeEach(() => {
  resetAccessMock();
});

describe("the access officer's law enforcement request (S11)", () => {
  it('reads the whole request, with the agency, provenance and register', async () => {
    const result = await loadLeaRequest(officer(), L.received);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data).toMatchObject({
      status: 'received',
      agency: { code: 'DCI' },
      officer: { name: 'Suleiman Ali' },
      caseReference: 'DCI/ECU/142/2026',
      provenance: { accountState: 'activated' },
    });
    expect(result.data.timeline.map((entry) => entry.kind)).toEqual(['received']);
  });

  it("does not show another Commission's request", async () => {
    const result = await loadLeaRequest(officer(), L.tsc);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it('searches the roster for the officer sought', async () => {
    const result = await searchLeaRoster(officer(), L.received, 'kamau');
    if (!result.ok) throw new Error('not ok');
    expect(result.data.items.map((each) => each.fullName)).toEqual([
      'Grace Nyambura Kamau',
      'Peter Mwangi Kamau',
    ]);
  });

  it('S11: verifies, then grants: the declarant is told after, the package follows', async () => {
    const verified = await verifyLeaRequest(officer(), L.received, VERIFY, key());
    if (!verified.ok) throw new Error(JSON.stringify(verified.error));
    expect(verified.data).toMatchObject({
      status: 'verified',
      resolvedName: 'Grace Nyambura Kamau',
      verification: { note: VERIFY.note },
    });
    const again = await verifyLeaRequest(officer(), L.received, VERIFY, key());
    expect(again).toMatchObject({
      ok: false,
      error: { problem: { status: 409, code: 'officer-resolved' } },
    });

    const granted = await decideLeaRequest(
      officer(),
      L.received,
      { outcome: 'grant', reasons: 'Stated reason and case reference.' },
      key(),
    );
    if (!granted.ok) throw new Error(JSON.stringify(granted.error));
    expect(granted.data).toMatchObject({ status: 'granted', package: null });
    expect(granted.data.declarantNotifiedAt).not.toBeNull();
    expect(granted.data.timeline.map((entry) => entry.kind)).toEqual([
      'received',
      'verified',
      'decided',
      'notified',
    ]);
  });

  it('S11: denies with grounds even before verification; the declarant is not told', async () => {
    const grant = await decideLeaRequest(
      officer(),
      L.received,
      { outcome: 'grant', reasons: 'Fine.' },
      key(),
    );
    expect(grant).toMatchObject({
      ok: false,
      error: { problem: { status: 409, code: 'not-under-decision' } },
    });
    const denied = await decideLeaRequest(
      officer(),
      L.received,
      { outcome: 'deny', grounds: ['not-objectives'], reasons: 'Officer not identified.' },
      key(),
    );
    if (!denied.ok) throw new Error(JSON.stringify(denied.error));
    expect(denied.data).toMatchObject({ status: 'denied', declarantNotifiedAt: null });
  });

  it('lets the supervisor read but not act', async () => {
    expect((await loadLeaRequest(supervisor(), L.received)).ok).toBe(true);
    const verify = await verifyLeaRequest(supervisor(), L.received, VERIFY, key());
    expect(verify).toMatchObject({ ok: false, error: { problem: { status: 403 } } });
  });
});

describe("the law enforcement officer's requests (S11)", () => {
  it('lists only their own, latest first, across Commissions', async () => {
    const result = await listMyLeaRequests(lea());
    if (!result.ok) throw new Error('not ok');
    const ids = result.data.map((request) => request.id);
    expect(ids[0]).toBe(L.received);
    expect(ids).toContain(L.tsc);
    expect(ids).not.toContain(L.breach);
    expect(ids).not.toContain(L.verified);
  });

  it("names nobody but the officer on their request's timeline", async () => {
    const result = await loadLeaRequest(lea(), L.granted);
    if (!result.ok) throw new Error('not ok');
    const actors = result.data.timeline.flatMap((entry) => (entry.actor ? [entry.actor] : []));
    expect(new Set(actors)).toEqual(new Set(['Suleiman Ali']));
    expect(result.data.verification?.by.name).toBe('');
  });

  it("finds another officer's request not found", async () => {
    const result = await loadLeaRequest(lea(), L.verified);
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 404 } } });
  });

  it('lists the Commissions with their years', async () => {
    const result = await listRequestCommissions(lea());
    if (!result.ok) throw new Error('not ok');
    expect(result.data.find((each) => each.slug === 'psc')?.years).toEqual([2025, 2026]);
    expect((await listRequestCommissions(officer())).ok).toBe(false);
  });

  it('S11: files a written request: LEA reference, received, 14 days', async () => {
    const result = await submitLeaRequest(lea(), INPUT, key());
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.reference).toMatch(/^LEA-PSC-2026-\d{7}-[0-9A-Z]$/);
    expect(result.data.status).toBe('received');
    expect(Date.parse(result.data.deadlineAt) - Date.parse(result.data.receivedAt)).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
    const mine = await listMyLeaRequests(lea());
    expect(mine.ok && mine.data[0]?.id).toBe(result.data.id);
  });

  it('refuses a request the service does not accept, naming the field', async () => {
    const result = await submitLeaRequest(
      lea(),
      { ...INPUT, caseReference: 'DCI/duplicate/1' },
      key(),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400, errors: [{ path: 'caseReference' }] } },
    });
  });

  it('downloads a granted package from documents while its window is open', async () => {
    const request = await loadLeaRequest(lea(), L.granted);
    if (!request.ok || !request.data.package) throw new Error('no package');
    const link = await packageDownload(documents(), request.data.package.documentId);
    expect(link).toMatchObject({
      ok: true,
      data: { downloadUrl: expect.stringContaining('/api/mock-files/') as unknown },
    });
    const after = await loadLeaRequest(lea(), L.granted);
    expect(after.ok && after.data.package?.downloads).toBe(2);
  });

  it('says the window closed (410)', async () => {
    const request = await loadLeaRequest(lea(), L.expired);
    if (!request.ok || !request.data.package) throw new Error('no package');
    const link = await packageDownload(documents(), request.data.package.documentId);
    expect(link).toEqual({ ok: false, error: { kind: 'window-closed' } });
  });
});
