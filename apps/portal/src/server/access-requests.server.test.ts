import { hasValidCheckCharacter, parse } from '@adili/numbering/references';
import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FormKDraft, formKDraftSchema } from '../access/form-k';
import { decisionClock } from '../access/progress';
import {
  closedAt,
  listRequests,
  loadApplicant,
  loadNewRequest,
  loadRequest,
  readPackageDownload,
  submitRequest,
  withdrawRequest,
} from './access-requests.server';
import {
  failNextAccessCall,
  MOCK_ACCESS_REQUEST_IDS as IDS,
  mockAccessFetch,
  resetAccessMock,
  setAccessMockLatency,
} from './access/mock.server';
import type { paths as AccessPaths } from './access/schema.gen';
import type { paths as DocumentsPaths } from './documents/schema.gen';
import { mockDirectoryFetch } from './directory/mock.server';
import type { paths as DirectoryPaths } from './directory/schema.gen';

const NOW = Date.parse('2026-10-02T07:00:00Z');

/** An unsigned token with these realm roles; the mocks read its claims without checking it. */
function token(roles: string[], username = 'applicant') {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ preferred_username: username, realm_access: { roles } })}.`;
}

function clients(roles = ['applicant'], username?: string) {
  const headers = { authorization: `Bearer ${token(roles, username)}` };
  return {
    access: createClient<AccessPaths>({
      baseUrl: 'http://access.test',
      fetch: mockAccessFetch,
      headers,
    }),
    documents: createClient<DocumentsPaths>({
      baseUrl: 'http://documents.test',
      fetch: mockAccessFetch,
      headers,
    }),
    directory: createClient<DirectoryPaths>({
      baseUrl: 'http://directory.test',
      fetch: mockDirectoryFetch,
      headers,
    }),
  };
}

const down = () => Promise.reject(new TypeError('fetch failed'));

const DRAFT: FormKDraft = {
  commission: 'psc',
  postalAddress: 'P.O. Box 49010-00100, Nairobi',
  physicalAddress: 'Othaya Road, Kileleshwa, Nairobi',
  occupation: 'Journalist',
  officer: {
    name: 'Peter Mwangi Kamau',
    entity: 'State Department for Housing and Urban Development',
    workStation: 'Ardhi House, Nairobi',
    personnelFileNumber: '',
  },
  information: {
    informationSought: 'Assets declared in the 2026 initial declaration.',
    reason: 'The officer approved housing tenders to a company linked to them.',
    otherInformation: '',
  },
  scope: {
    years: [2026],
    includeSpouses: false,
    includeChildren: false,
    sections: ['assets'],
    includeClarifications: false,
  },
  declared: true,
};

const checked = (draft: FormKDraft = DRAFT) => formKDraftSchema.parse(draft);

beforeEach(() => {
  resetAccessMock(NOW);
  setAccessMockLatency(0);
});

describe('loadApplicant', () => {
  it('reads the applicant’s particulars from the directory', async () => {
    const { directory } = clients();
    expect(await loadApplicant(directory)).toEqual({
      status: 'ok',
      applicant: {
        name: 'Mercy Wanjiku Kamau',
        identityDocument: { kind: 'national-id', number: '28841276', country: null },
        identityStatus: 'verified',
        telephone: '+254722418903',
        email: 'mercy.kamau@example.com',
      },
    });
  });

  it('says an account without the applicant role is not an applicant', async () => {
    expect(await loadApplicant(clients(['declarant']).directory)).toEqual({
      status: 'not-applicant',
    });
  });
});

describe('loadNewRequest', () => {
  it('opens the wizard with the applicant and the Commissions by name', async () => {
    const { directory, access } = clients();
    const result = await loadNewRequest(directory, access);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.commissions.map((each) => each.name)).toEqual([
      'Judicial Service Commission',
      'Kiambu County Public Service Board',
      'National Police Service Commission',
      'Public Service Commission',
      'Teachers Service Commission',
    ]);
    expect(result.draft).toBeNull();
  });

  it('starts from an earlier request’s details when asked', async () => {
    const { directory, access } = clients();
    const result = await loadNewRequest(directory, access, IDS.cannot);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.draft).toMatchObject({
      commission: 'npsc',
      officer: { name: 'James Otieno', entity: 'National Police Service' },
      declared: false,
    });
  });

  it('is unavailable when the access service is down', async () => {
    const { directory } = clients();
    const access = createClient<AccessPaths>({ baseUrl: 'http://access.test', fetch: down });
    expect(await loadNewRequest(directory, access)).toEqual({ status: 'unavailable' });
  });
});

describe('submitRequest', () => {
  it('S2: files Form K with the account’s particulars and gets an ARQ reference', async () => {
    const { directory, access } = clients();
    const result = await submitRequest(
      directory,
      access,
      checked(),
      crypto.randomUUID(),
      new Date(NOW),
    );
    if (result.status !== 'submitted') throw new Error(result.status);
    const parsed = parse(result.reference);
    expect(parsed.scheme).toBe('ARQ');
    expect(hasValidCheckCharacter(result.reference)).toBe(true);
    const filed = await loadRequest(access, result.id);
    if (filed.status !== 'ok') throw new Error(filed.status);
    expect(filed.request.status).toBe('submitted');
    expect(filed.request.formK.partI).toMatchObject({
      name: 'Mercy Wanjiku Kamau',
      identityDocument: { kind: 'national-id', number: '28841276' },
      telephone: '+254722418903',
      email: 'mercy.kamau@example.com',
      occupation: 'Journalist',
    });
  });

  it('S2: a passport applicant’s request waits for identity verification', async () => {
    const { directory, access } = clients(['applicant'], 'applicant-passport');
    const result = await submitRequest(
      directory,
      access,
      checked(),
      crypto.randomUUID(),
      new Date(NOW),
    );
    if (result.status !== 'submitted') throw new Error(result.status);
    const filed = await loadRequest(access, result.id);
    expect(filed.status === 'ok' && filed.request.status).toBe('pending-applicant-verification');
  });

  it('replays the first receipt for a retry with the same key', async () => {
    const { directory, access } = clients();
    const key = crypto.randomUUID();
    const first = await submitRequest(directory, access, checked(), key, new Date(NOW));
    const again = await submitRequest(directory, access, checked(), key, new Date(NOW));
    expect(again).toEqual(first);
  });

  it('S2: puts the fields the service refused on their step', async () => {
    const { directory, access } = clients();
    const draft = { ...DRAFT, officer: { ...DRAFT.officer, name: 'Rejected Officer' } };
    expect(
      await submitRequest(directory, access, checked(draft), crypto.randomUUID(), new Date(NOW)),
    ).toEqual({
      status: 'invalid',
      steps: ['officer'],
      errors: { 'officer.name': 'Enter the officer’s full name.' },
    });
  });

  it('is unavailable when the service is down, and not an applicant without the role', async () => {
    const { directory, access } = clients();
    failNextAccessCall();
    expect(
      await submitRequest(directory, access, checked(), crypto.randomUUID(), new Date(NOW)),
    ).toEqual({ status: 'unavailable' });
    const declarant = clients(['declarant']);
    expect(
      await submitRequest(
        declarant.directory,
        declarant.access,
        checked(),
        crypto.randomUUID(),
        new Date(NOW),
      ),
    ).toEqual({ status: 'not-applicant' });
  });
});

describe('listRequests', () => {
  it('lists the applicant’s requests, latest first, one in every status', async () => {
    const result = await listRequests(clients().access);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(new Set(result.requests.map((each) => each.status))).toEqual(
      new Set([
        'submitted',
        'pending-applicant-verification',
        'officer-unresolved',
        'awaiting-representations',
        'under-decision',
        'granted',
        'partially-granted',
        'denied',
        'cannot-identify',
        'withdrawn',
      ]),
    );
    const submitted = result.requests.map((each) => each.submittedAt);
    expect(submitted).toEqual([...submitted].sort().reverse());
    const withdrawn = result.requests.find((each) => each.status === 'withdrawn');
    expect(withdrawn?.closedAt).not.toBeNull();
    expect(result.requests.find((each) => each.status === 'submitted')?.closedAt).toBeNull();
  });

  it('says a non-applicant is not one', async () => {
    expect(await listRequests(clients(['declarant']).access)).toEqual({
      status: 'not-applicant',
    });
  });
});

describe('loadRequest', () => {
  it('dates the seeds by Kenyan day, even between 00:00 and 03:00 in Nairobi', async () => {
    // 01:00 on 3 October in Nairobi, while UTC is still on 2 October.
    const night = Date.parse('2026-10-02T22:00:00Z');
    resetAccessMock(night);
    const result = await loadRequest(clients().access, IDS.deciding);
    if (result.status !== 'ok') throw new Error(result.status);
    // Submitted 27 Kenyan days ago, at 09:12 in Nairobi: day 27 of 30, due in 3 days.
    expect(result.request.submittedAt).toBe('2026-09-06T06:12:00.000Z');
    expect(decisionClock(result.request, night)).toMatchObject({ day: 27, of: 30, daysLeft: 3 });
  });

  it('is not found for a request that is not the applicant’s', async () => {
    expect(await loadRequest(clients().access, crypto.randomUUID())).toEqual({
      status: 'not-found',
    });
  });
});

describe('withdrawRequest', () => {
  it('S8: withdraws a request before a decision', async () => {
    const { access } = clients();
    const result = await withdrawRequest(access, IDS.notified, crypto.randomUUID());
    if (result.status !== 'withdrawn') throw new Error(result.status);
    expect(result.request.status).toBe('withdrawn');
    expect(closedAt(result.request)).not.toBeNull();
  });

  it('S8: refuses once decided (409 request-decided), or once closed', async () => {
    const { access } = clients();
    expect(await withdrawRequest(access, IDS.granted, crypto.randomUUID())).toEqual({
      status: 'conflict',
      reason: 'decided',
    });
    expect(await withdrawRequest(access, IDS.withdrawn, crypto.randomUUID())).toEqual({
      status: 'conflict',
      reason: 'closed',
    });
    expect(await withdrawRequest(access, IDS.cannot, crypto.randomUUID())).toEqual({
      status: 'conflict',
      reason: 'closed',
    });
  });

  it('S8: says so when the Commission decided first', async () => {
    const { access } = clients();
    expect(await withdrawRequest(access, IDS.late, crypto.randomUUID())).toEqual({
      status: 'conflict',
      reason: 'decided',
    });
    const after = await loadRequest(access, IDS.late);
    expect(after.status === 'ok' && after.request.status).toBe('denied');
  });

  it('is not found for another applicant’s request, unavailable when the service is down', async () => {
    const { access } = clients();
    expect(await withdrawRequest(access, crypto.randomUUID(), crypto.randomUUID())).toEqual({
      status: 'not-found',
    });
    failNextAccessCall();
    expect(await withdrawRequest(access, IDS.submitted, crypto.randomUUID())).toEqual({
      status: 'unavailable',
    });
  });
});

describe('readPackageDownload (#261, S7)', () => {
  async function packageOf(id: string) {
    const loaded = await loadRequest(clients().access, id);
    if (loaded.status !== 'ok' || !loaded.request.package) throw new Error('no package');
    return loaded.request.package;
  }

  it('links to the package and registers the download', async () => {
    const before = await packageOf(IDS.granted);
    const result = await readPackageDownload(clients().documents, before.documentId);
    expect(result).toEqual({
      status: 'ok',
      downloadUrl: `/api/mock-packages/${before.documentId}`,
    });
    const after = await loadRequest(clients().access, IDS.granted);
    if (after.status !== 'ok') throw new Error(after.status);
    expect(after.request.package?.downloads).toBe(1);
    expect(after.request.timeline.at(-1)?.kind).toBe('downloaded');
  });

  describe('on a wall clock past the seeded windows', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('answers as of when the mock was seeded, not the wall clock', async () => {
      // Seeded as of NOW, but run a month later: every seeded window has closed by the wall clock.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW + 30 * 86_400_000);
      resetAccessMock(NOW);
      const { documentId } = await packageOf(IDS.granted);
      expect(await readPackageDownload(clients().documents, documentId)).toEqual({
        status: 'ok',
        downloadUrl: `/api/mock-packages/${documentId}`,
      });
    });
  });

  it('is refused with 410 once the window has closed', async () => {
    const { documentId } = await packageOf(IDS.expired);
    expect(await readPackageDownload(clients().documents, documentId)).toEqual({
      status: 'window-closed',
    });
  });

  it('closes the window ending today at the first attempt, as if it ended meanwhile', async () => {
    const { documentId } = await packageOf(IDS.expiring);
    expect(await readPackageDownload(clients().documents, documentId)).toEqual({
      status: 'window-closed',
    });
    const after = await loadRequest(clients().access, IDS.expiring);
    if (after.status !== 'ok') throw new Error(after.status);
    expect(after.request.timeline.at(-1)?.kind).toBe('expired');
  });

  it('is not found for a document that is not the applicant’s package', async () => {
    expect(await readPackageDownload(clients().documents, crypto.randomUUID())).toEqual({
      status: 'not-found',
    });
    const { documentId } = await packageOf(IDS.granted);
    expect(await readPackageDownload(clients(['declarant']).documents, documentId)).toEqual({
      status: 'not-found',
    });
  });

  it('reads documents being down as unavailable', async () => {
    const documents = createClient<DocumentsPaths>({
      baseUrl: 'http://documents.test',
      fetch: down,
    });
    expect(await readPackageDownload(documents, crypto.randomUUID())).toEqual({
      status: 'unavailable',
    });
    const { documentId } = await packageOf(IDS.partial);
    expect(await readPackageDownload(clients().documents, documentId)).toEqual({
      status: 'unavailable',
    });
    expect((await readPackageDownload(clients().documents, documentId)).status).toBe('ok');
  });
});
