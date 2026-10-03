/**
 * In-memory stand-in for the access service's written self-access endpoints (access.yaml, spec
 * 10 slice #302) and the documents calls around them (proof uploads, the certified copy's
 * download), used when ACCESS_MOCK is set. Dated relative to when it was seeded, it holds the
 * PSC's applications in every state the Certified copies screens show:
 *
 * - `failed`: Alice Nekesa Wafula in person, 18 days ago; the copy could not be issued (late).
 * - `preparing`: Hassan Abdi Noor in person today, for dispatch; the copy is still being issued.
 * - `ready`: Margaret Achieng Odhiambo through her representative, for collection; issued.
 * - `colleague`: issued, recorded by another access officer (who alone may download it).
 * - `dispatched`, `collected`: handed over.
 *
 * The roster searches by name or file number ("Wafula", "Mutua"; "Kariuki" has not onboarded;
 * "offline" is 503). A recorded application's copy is issued three seconds later, except a copy
 * of Anne Njeri Mutua's superseded version 1, which fails (the failed state). Seeded
 * applications other than `colleague` read as recorded by whichever access officer asks, so the
 * signed-in officer can print them. Only the access officer acts; a supervisor gets 403, as the
 * service answers.
 *
 * Proofs upload to `/api/mock-uploads/{id}` (`routes/api/mock-uploads.$id.ts`); a file whose
 * name contains "virus" fails the scan. Copies download from `/api/mock-files/{id}`.
 */
import { randomUUID } from 'node:crypto';

import { addDays, nairobiDayStartOf } from '@adili/ui';
import createClient from 'openapi-fetch';

import type { paths as DocumentsPaths } from '../documents/api.gen';
import { isRecord, json, problem, readJson } from '../mock-http';
import type { components } from './api.gen';
import type { RosterCandidate } from './types';

type Schemas = components['schemas'];
type Detail = Schemas['SelfAccessApplicationDetail'];
type Version = Schemas['DeclarantVersion'];

const PSC = { slug: 'psc', name: 'Public Service Commission' };
const DAY_MS = 24 * 60 * 60 * 1000;
const DEADLINE_DAYS = 14;
/** How long the mock's workflow takes to issue a recorded application's copy. */
const ISSUE_AFTER_MS = 3000;
/** Stands for "whoever asks" as the recording officer of a seeded application. */
const ANY_OFFICER = '*';

export const MOCK_SELF_ACCESS_IDS = {
  failed: 'a12c0000-0000-4000-8000-000000000001',
  preparing: 'a12c0000-0000-4000-8000-000000000002',
  ready: 'a12c0000-0000-4000-8000-000000000003',
  colleague: 'a12c0000-0000-4000-8000-000000000004',
  dispatched: 'a12c0000-0000-4000-8000-000000000005',
  collected: 'a12c0000-0000-4000-8000-000000000006',
} as const;

interface Declarant {
  record: RosterCandidate;
  versions: Version[];
}

function versionOf(
  declarationId: string,
  version: number,
  reference: string,
  type: Version['type'],
  statementDate: string,
  submittedAt: string,
  superseded = false,
): Version {
  return { declarationId, version, reference, type, statementDate, submittedAt, superseded };
}

function record(
  id: string,
  personnelFileNumber: string,
  fullName: string,
  designation: string,
  reportingEntity: string,
  onboarded = true,
): RosterCandidate {
  return {
    id,
    personnelFileNumber,
    fullName,
    designation,
    reportingEntity,
    state: onboarded ? 'onboarded' : 'not_onboarded',
    onboarded,
  };
}

const DECLARANTS: Declarant[] = [
  {
    record: record(
      'a12d0000-0000-4000-8000-000000000001',
      '20118876',
      'Alice Nekesa Wafula',
      'County Director of Education',
      'State Department for Basic Education',
    ),
    versions: [
      versionOf(
        'a12e0000-0000-4000-8000-000000000001',
        2,
        'DCB-PSC-2026-0118876-4',
        'biennial',
        '2026-12-31',
        '2026-03-28T09:12:00.000Z',
      ),
      versionOf(
        'a12e0000-0000-4000-8000-000000000001',
        1,
        'DCB-PSC-2026-0118876-4',
        'biennial',
        '2026-12-31',
        '2026-03-12T10:40:00.000Z',
        true,
      ),
      versionOf(
        'a12e0000-0000-4000-8000-000000000002',
        1,
        'DCI-PSC-2025-0118876-8',
        'initial',
        '2025-09-30',
        '2025-10-03T08:05:00.000Z',
      ),
    ],
  },
  {
    record: record(
      'a12d0000-0000-4000-8000-000000000002',
      '20114512',
      'Anne Njeri Mutua',
      'Senior Assistant Secretary',
      'State Department for Public Service',
    ),
    versions: [
      versionOf(
        'a12e0000-0000-4000-8000-000000000003',
        2,
        'DCI-PSC-2026-0114512-7',
        'initial',
        '2026-06-30',
        '2026-07-15T09:12:00.000Z',
      ),
      versionOf(
        'a12e0000-0000-4000-8000-000000000003',
        1,
        'DCI-PSC-2026-0114512-7',
        'initial',
        '2026-06-30',
        '2026-07-02T11:30:00.000Z',
        true,
      ),
    ],
  },
  {
    record: record(
      'a12d0000-0000-4000-8000-000000000003',
      '20128841',
      'Hassan Abdi Noor',
      'Deputy County Commissioner',
      'State Department for Internal Security',
    ),
    versions: [
      versionOf(
        'a12e0000-0000-4000-8000-000000000004',
        1,
        'DCB-PSC-2026-0128841-7',
        'biennial',
        '2026-12-31',
        '2026-02-20T07:55:00.000Z',
      ),
    ],
  },
  {
    record: record(
      'a12d0000-0000-4000-8000-000000000004',
      '20150662',
      'Margaret Achieng Odhiambo',
      'Principal Accountant',
      'The National Treasury',
    ),
    versions: [
      versionOf(
        'a12e0000-0000-4000-8000-000000000005',
        1,
        'DCB-PSC-2026-0150662-4',
        'biennial',
        '2026-12-31',
        '2026-03-01T12:00:00.000Z',
      ),
    ],
  },
  {
    record: record(
      'a12d0000-0000-4000-8000-000000000005',
      '20099314',
      'Esther Wairimu Njoroge',
      'Assistant Director, ICT',
      'State Department for Public Service',
    ),
    versions: [
      versionOf(
        'a12e0000-0000-4000-8000-000000000006',
        1,
        'DCB-PSC-2026-0099314-5',
        'biennial',
        '2026-12-31',
        '2026-01-19T09:30:00.000Z',
      ),
    ],
  },
  {
    record: record(
      'a12d0000-0000-4000-8000-000000000006',
      '20077719',
      'Rose Chepkemoi Kirui',
      'Chief Executive Officer',
      'Kenya Rural Roads Authority',
    ),
    versions: [
      versionOf(
        'a12e0000-0000-4000-8000-000000000007',
        1,
        'DCB-PSC-2026-0077719-7',
        'biennial',
        '2026-12-31',
        '2026-02-11T14:20:00.000Z',
      ),
    ],
  },
  {
    record: record(
      'a12d0000-0000-4000-8000-000000000007',
      '20133090',
      'Daniel Mwangi Kariuki',
      'Housing Officer',
      'State Department for Housing and Urban Development',
      false,
    ),
    versions: [],
  },
];

interface Stored {
  detail: Omit<Detail, 'recordedByCaller'>;
  /** The recording officer's subject, or `ANY_OFFICER`. */
  recordedBySubject: string;
  /** When the mock's workflow issues the copy, or fails it; null once settled. */
  settleAt: number | null;
  fails: boolean;
}

interface MockUpload {
  id: string;
  fileName: string;
  contentType: string;
  declaredSize: number;
  size: number | null;
  uploadedBy: string;
  state: 'pending' | 'clean' | 'infected';
  createdAt: string;
}

const applications = new Map<string, Stored>();
const uploads = new Map<string, MockUpload>();

function iso(at: number): string {
  return new Date(at).toISOString();
}

function declarantOf(id: string): Declarant | undefined {
  return DECLARANTS.find((each) => each.record.id === id);
}

interface Seed {
  id: string;
  declarant: number;
  version: number;
  representative?: { name: string; idNumber: string; authority: string; id: string };
  deliveryMethod: Detail['deliveryMethod'];
  daysAgo: number;
  copy: 'pending' | 'failed' | 'issued';
  issuedDaysAfter?: number;
  deliveredDaysAfter?: number;
  recordedBy?: { subject: string; name: string };
  identityNote: string;
}

const SEEDS: Seed[] = [
  {
    id: MOCK_SELF_ACCESS_IDS.failed,
    declarant: 0,
    version: 2,
    deliveryMethod: 'collection',
    daysAgo: 18,
    copy: 'failed',
    identityNote: 'National ID seen. It matches the roster record.',
  },
  {
    id: MOCK_SELF_ACCESS_IDS.preparing,
    declarant: 2,
    version: 1,
    deliveryMethod: 'dispatch',
    daysAgo: 0,
    copy: 'pending',
    identityNote: 'Service card seen. It matches the roster record.',
  },
  {
    id: MOCK_SELF_ACCESS_IDS.ready,
    declarant: 3,
    version: 1,
    representative: {
      name: 'Paul Oduor Otieno',
      idNumber: '28817364',
      authority: 'authority-letter-margaret-odhiambo.pdf',
      id: 'paul-otieno-national-id.jpg',
    },
    deliveryMethod: 'collection',
    daysAgo: 9,
    copy: 'issued',
    issuedDaysAfter: 1,
    identityNote:
      "Representative's national ID seen against him. The declarant's National ID on the signed authority matches the roster record.",
  },
  {
    id: MOCK_SELF_ACCESS_IDS.colleague,
    declarant: 1,
    version: 2,
    deliveryMethod: 'collection',
    daysAgo: 4,
    copy: 'issued',
    issuedDaysAfter: 0,
    recordedBy: { subject: 'mock-other-officer', name: 'Grace Atieno' },
    identityNote: 'National ID seen. It matches the roster record.',
  },
  {
    id: MOCK_SELF_ACCESS_IDS.dispatched,
    declarant: 4,
    version: 1,
    deliveryMethod: 'dispatch',
    daysAgo: 24,
    copy: 'issued',
    issuedDaysAfter: 2,
    deliveredDaysAfter: 3,
    identityNote: 'Passport seen. It matches the roster record.',
  },
  {
    id: MOCK_SELF_ACCESS_IDS.collected,
    declarant: 5,
    version: 1,
    representative: {
      name: 'Kiprotich Kirui',
      idNumber: '31120457',
      authority: 'authority-rose-kirui.pdf',
      id: 'kiprotich-kirui-id.pdf',
    },
    deliveryMethod: 'collection',
    daysAgo: 40,
    copy: 'issued',
    issuedDaysAfter: 3,
    deliveredDaysAfter: 6,
    identityNote:
      "Representative's national ID seen against him. The declarant's National ID on the signed authority matches the roster record.",
  },
];

/** Minutes later in the morning per day back a seed was received, so no two share a time. */
const STAGGER_MINUTES_PER_DAY = 7;

/**
 * Seeded mornings, so the screens read like an office day whenever the mock starts: `daysAgo`
 * Kenyan calendar days ago, as the screens count days, at 09:30 in Nairobi plus
 * `STAGGER_MINUTES_PER_DAY` for each of those days. Today's is never later than now, nor
 * before today's Kenyan midnight.
 */
function morningOf(now: number, daysAgo: number): number {
  const dayStart = Date.parse(addDays(nairobiDayStartOf(new Date(now).toISOString()), -daysAgo));
  const morning = dayStart + (9 * 60 + 30 + daysAgo * STAGGER_MINUTES_PER_DAY) * 60_000;
  return Math.min(morning, Math.max(dayStart, now - 60_000));
}

function build(seed: Seed, now: number): Stored {
  const declarant = DECLARANTS[seed.declarant];
  if (!declarant) throw new Error('unknown seed declarant');
  const version = declarant.versions.find((each) => each.version === seed.version);
  if (!version) throw new Error('unknown seed version');
  const receivedAt = morningOf(now, seed.daysAgo);
  const issuedAt =
    seed.copy === 'issued' ? receivedAt + (seed.issuedDaysAfter ?? 0) * DAY_MS + 3_600_000 : null;
  const deliveredAt =
    seed.deliveredDaysAfter === undefined ? null : receivedAt + seed.deliveredDaysAfter * DAY_MS;
  const detail = detailOf({
    id: seed.id,
    declarant,
    version,
    representative: seed.representative
      ? {
          name: seed.representative.name,
          idNumber: seed.representative.idNumber,
          authority: { uploadId: randomUUID(), fileName: seed.representative.authority },
          identification: { uploadId: randomUUID(), fileName: seed.representative.id },
        }
      : null,
    deliveryMethod: seed.deliveryMethod,
    receivedAt,
    identityNote: seed.identityNote,
    recordedBy: seed.recordedBy?.name ?? 'Lucy Wambui',
  });
  if (seed.copy === 'failed') detail.certifiedCopy.status = 'failed';
  if (issuedAt !== null) issue(detail, issuedAt);
  if (deliveredAt !== null) {
    detail.status = 'delivered';
    detail.deliveredAt = iso(deliveredAt);
  }
  return {
    detail,
    recordedBySubject: seed.recordedBy?.subject ?? ANY_OFFICER,
    settleAt: null,
    fails: false,
  };
}

function detailOf(facts: {
  id: string;
  declarant: Declarant;
  version: Version;
  representative: Detail['representative'];
  deliveryMethod: Detail['deliveryMethod'];
  receivedAt: number;
  identityNote: string;
  recordedBy: string;
}): Stored['detail'] {
  const { record: roster } = facts.declarant;
  return {
    id: facts.id,
    status: 'recorded',
    declarant: {
      rosterRecordId: roster.id,
      fullName: roster.fullName,
      personnelFileNumber: roster.personnelFileNumber,
    },
    declarationId: facts.version.declarationId,
    version: facts.version.version,
    declarationReference: facts.version.reference,
    identityNote: facts.identityNote,
    representative: facts.representative,
    deliveryMethod: facts.deliveryMethod,
    receivedAt: iso(facts.receivedAt),
    deadlineAt: iso(facts.receivedAt + DEADLINE_DAYS * DAY_MS),
    late: false,
    deliveredAt: null,
    recordedBy: facts.recordedBy,
    certifiedCopy: {
      id: randomUUID(),
      commission: PSC,
      declarationId: facts.version.declarationId,
      version: facts.version.version,
      reference: null,
      status: 'pending',
      documentId: null,
      verificationId: null,
      requestedAt: iso(facts.receivedAt),
      issuedAt: null,
    },
  };
}

function issue(detail: Stored['detail'], at: number) {
  detail.status = 'issued';
  detail.certifiedCopy = {
    ...detail.certifiedCopy,
    status: 'issued',
    reference: detail.declarationReference,
    documentId: randomUUID(),
    verificationId: `ADL-${detail.id.slice(-4).toUpperCase()}-M2XR-9HTC-2B7F`,
    issuedAt: iso(at),
  };
}

export function resetSelfAccessMock(now: number = Date.now()) {
  applications.clear();
  uploads.clear();
  for (const seed of SEEDS) applications.set(seed.id, build(seed, now));
}

function ensureSeeded() {
  if (applications.size === 0) resetSelfAccessMock();
}

/** Runs the mock workflow: a recorded copy is issued (or fails) once its time has come. */
function advance(stored: Stored, now: number) {
  if (stored.settleAt === null || now < stored.settleAt) return;
  const at = stored.settleAt;
  stored.settleAt = null;
  if (stored.fails) stored.detail.certifiedCopy.status = 'failed';
  else issue(stored.detail, at);
}

/** As the service has it: not issued by the deadline, by now or by when it was issued. */
function withLate(stored: Stored, now: number): Stored['detail'] {
  const { detail } = stored;
  const issuedAt = detail.certifiedCopy.issuedAt ? Date.parse(detail.certifiedCopy.issuedAt) : now;
  return { ...detail, late: issuedAt > Date.parse(detail.deadlineAt) };
}

interface Caller {
  subject: string;
  name: string;
  accessOfficer: boolean;
}

function callerOf(request: Request): Caller {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sub?: unknown; name?: unknown; realm_access?: { roles?: unknown } };
    const roles = Array.isArray(claims.realm_access?.roles) ? claims.realm_access.roles : [];
    return {
      subject: typeof claims.sub === 'string' ? claims.sub : 'unknown',
      name: typeof claims.name === 'string' ? claims.name : 'You',
      accessOfficer: roles.includes('access-officer'),
    };
  } catch {
    return { subject: 'unknown', name: 'You', accessOfficer: true };
  }
}

function recordedByCaller(stored: Stored, caller: Caller): boolean {
  return (
    (stored.recordedBySubject === ANY_OFFICER && caller.accessOfficer) ||
    stored.recordedBySubject === caller.subject
  );
}

function detailFor(stored: Stored, caller: Caller, now: number): Detail {
  return { ...withLate(stored, now), recordedByCaller: recordedByCaller(stored, caller) };
}

function listItem(stored: Stored, now: number): Schemas['SelfAccessApplication'] {
  const { representative, ...detail } = withLate(stored, now);
  return {
    ...detail,
    representative: representative
      ? {
          name: representative.name,
          authority: representative.authority,
          identification: representative.identification,
        }
      : null,
  };
}

/** How much slower than nothing the mock answers, so busy states show; tests set 0. */
let latency = 1;

export function setSelfAccessMockLatency(factor: number) {
  latency = factor;
}

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms * latency);
  });

const SUPERVISOR_READS =
  'The Commission supervisor reads applications; only its access officer acts';

function validation(path: string, message: string): Response {
  return json(400, {
    type: 'about:blank',
    title: 'Bad Request',
    status: 400,
    errors: [{ path, message }],
  });
}

async function recordApplication(request: Request, caller: Caller): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) return problem(400, 'Bad Request');
  const declarant = declarantOf(String(body.rosterRecordId));
  if (!declarant?.record.onboarded) {
    return validation('rosterRecordId', 'is not an onboarded roster record of the Commission');
  }
  const version = declarant.versions.find(
    (each) => each.declarationId === body.declarationId && each.version === body.version,
  );
  if (!version) return validation('version', 'is not a submitted version of the declarant');
  const note = typeof body.identityNote === 'string' ? body.identityNote.trim() : '';
  if (!note || note.length > 1000) return validation('identityNote', 'is required');
  const rep = isRecord(body.representative) ? body.representative : null;
  let representative: Detail['representative'] = null;
  if (rep) {
    const proof = (field: 'authorityUploadId' | 'idUploadId') => {
      const upload = uploads.get(String(rep[field]));
      return upload?.state === 'clean' && upload.uploadedBy === caller.subject ? upload : null;
    };
    const authority = proof('authorityUploadId');
    if (!authority) return validation('representative.authorityUploadId', 'is not a clean upload');
    const identification = proof('idUploadId');
    if (!identification) return validation('representative.idUploadId', 'is not a clean upload');
    representative = {
      name: String(rep.name),
      idNumber: String(rep.idNumber),
      authority: { uploadId: authority.id, fileName: authority.fileName },
      identification: { uploadId: identification.id, fileName: identification.fileName },
    };
  }
  const now = Date.now();
  const id = randomUUID();
  const stored: Stored = {
    detail: detailOf({
      id,
      declarant,
      version,
      representative,
      deliveryMethod: body.deliveryMethod === 'dispatch' ? 'dispatch' : 'collection',
      receivedAt: now,
      identityNote: note,
      recordedBy: caller.name,
    }),
    recordedBySubject: caller.subject,
    settleAt: now + ISSUE_AFTER_MS,
    // Anne's superseded version 1 cannot be issued: the failed state.
    fails: declarant.record.fullName === 'Anne Njeri Mutua' && version.version === 1,
  };
  applications.set(id, stored);
  return json(201, detailFor(stored, caller, now));
}

function deliver(stored: Stored, caller: Caller, now: number): Response {
  const { detail } = stored;
  if (detail.status === 'delivered') {
    return problem(
      409,
      `The certified copy is marked ${detail.deliveryMethod === 'collection' ? 'collected' : 'dispatched'} already.`,
    );
  }
  if (detail.status !== 'issued') return problem(409, 'The certified copy is not issued yet.');
  detail.status = 'delivered';
  detail.deliveredAt = iso(now);
  return json(200, detailFor(stored, caller, now));
}

export async function mockSelfAccessFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const caller = callerOf(request);
  const now = Date.now();
  for (const stored of applications.values()) advance(stored, now);

  if (/^\/v1\/commissions\/[^/]+\/access\/self-access\/declarants$/.test(pathname)) {
    if (!caller.accessOfficer) return problem(403, SUPERVISOR_READS);
    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    if (q.length < 2) return problem(400, 'A search of at least 2 characters is required');
    if (q === 'offline') return problem(503, 'The directory cannot be reached');
    await delay(300);
    const items = DECLARANTS.map((each) => each.record)
      .filter(
        (each) =>
          each.personnelFileNumber.toLowerCase().startsWith(q) ||
          each.fullName.toLowerCase().includes(q),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return json(200, { items });
  }

  const versions =
    /^\/v1\/commissions\/[^/]+\/access\/self-access\/declarants\/([^/]+)\/versions$/.exec(pathname);
  if (versions) {
    if (!caller.accessOfficer) return problem(403, SUPERVISOR_READS);
    const declarant = declarantOf(versions[1] ?? '');
    if (!declarant) return problem(404, 'Not found');
    await delay(250);
    const { record: roster } = declarant;
    return json(200, {
      declarant: {
        rosterRecordId: roster.id,
        personnelFileNumber: roster.personnelFileNumber,
        fullName: roster.fullName,
        onboarded: roster.onboarded,
      },
      versions: declarant.versions,
    });
  }

  if (/^\/v1\/commissions\/[^/]+\/access\/self-access$/.test(pathname)) {
    if (method === 'POST') {
      if (!caller.accessOfficer) return problem(403, SUPERVISOR_READS);
      await delay(700);
      return recordApplication(request, caller);
    }
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const offset = Number(/^at-(\d+)$/.exec(url.searchParams.get('cursor') ?? '')?.[1] ?? '0');
    const items = [...applications.values()]
      .map((stored) => listItem(stored, now))
      // As the service orders them: still to hand over by earliest deadline, then delivered by latest.
      .sort((a, b) => {
        const deliveredA = a.status === 'delivered';
        const deliveredB = b.status === 'delivered';
        if (deliveredA !== deliveredB) return deliveredA ? 1 : -1;
        const byDeadline = deliveredA
          ? b.deadlineAt.localeCompare(a.deadlineAt)
          : a.deadlineAt.localeCompare(b.deadlineAt);
        return byDeadline || a.id.localeCompare(b.id);
      });
    return json(200, {
      items: items.slice(offset, offset + limit),
      nextCursor: offset + limit < items.length ? `at-${String(offset + limit)}` : null,
    });
  }

  const one = /^\/v1\/access\/self-access\/([^/]+)(\/delivered)?$/.exec(pathname);
  const stored = one?.[1] ? applications.get(one[1]) : undefined;
  if (!one || !stored) return problem(404, 'Not found');
  if (method === 'GET' && !one[2]) return json(200, detailFor(stored, caller, now));
  if (method === 'POST' && one[2]) {
    if (!caller.accessOfficer) return problem(403, SUPERVISOR_READS);
    await delay(500);
    return deliver(stored, caller, now);
  }
  return problem(404, 'Not found');
}

/** Documents as the self-access screens call it: proof uploads and the copy's download. */
export async function mockSelfAccessDocumentsFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const url = new URL(request.url);
  const { pathname } = url;
  const caller = callerOf(request);
  const now = Date.now();

  if (request.method === 'POST' && pathname === '/v1/uploads') {
    const body = await readJson(request);
    if (!isRecord(body) || body.purpose !== 'access-representation') {
      return problem(400, 'Bad Request');
    }
    const id = randomUUID();
    uploads.set(id, {
      id,
      fileName: String(body.fileName),
      contentType: String(body.contentType),
      declaredSize: Number(body.declaredSize),
      size: null,
      uploadedBy: caller.subject,
      state: 'pending',
      createdAt: iso(now),
    });
    return json(201, {
      id,
      uploadUrl: `/api/mock-uploads/${id}`,
      expiresAt: iso(now + 15 * 60_000),
      maxSize: 20 * 1024 * 1024,
    });
  }

  const complete = /^\/v1\/uploads\/([^/]+)\/complete$/.exec(pathname);
  if (request.method === 'POST' && complete) {
    const upload = uploads.get(complete[1] ?? '');
    if (upload?.uploadedBy !== caller.subject) return problem(404, 'Not found');
    await delay(1200);
    upload.state = /virus/i.test(upload.fileName) ? 'infected' : 'clean';
    upload.size ??= upload.declaredSize;
    return json(200, {
      id: upload.id,
      purpose: 'access-representation',
      state: upload.state,
      rejection: null,
      contentType: upload.contentType,
      detectedType: upload.contentType,
      declaredSize: upload.declaredSize,
      size: upload.size,
      sha256: upload.state === 'clean' ? 'a'.repeat(64) : null,
      fileName: upload.fileName,
      createdAt: upload.createdAt,
      completedAt: iso(Date.now()),
    });
  }

  const download = /^\/v1\/documents\/([^/]+)\/download$/.exec(pathname);
  if (request.method === 'GET' && download) {
    const stored = [...applications.values()].find(
      (each) => each.detail.certifiedCopy.documentId === download[1],
    );
    // Documents names only the recording officer on the copy: anyone else gets 404.
    if (!stored || !recordedByCaller(stored, caller)) return problem(404, 'Not found');
    return json(200, {
      downloadUrl: `/api/mock-files/${download[1] ?? ''}?inline`,
      expiresAt: iso(now + 5 * 60_000),
      sha256: 'b'.repeat(64),
    });
  }
  return problem(404, 'Not found');
}

/** An officer's upload the mock holds (a scan of a letter, a proof), for its file name. */
export function mockUploadOf(id: string): { fileName: string; uploadedBy: string } | undefined {
  const upload = uploads.get(id);
  return upload ? { fileName: upload.fileName, uploadedBy: upload.uploadedBy } : undefined;
}

/** The bytes of a proof the browser PUT to `/api/mock-uploads/{id}`. */
export function receiveMockProof(id: string, size: number): Response {
  const upload = uploads.get(id);
  if (!upload) return new Response(null, { status: 404 });
  upload.size = size;
  return new Response(null, { status: 200 });
}

/** What the placeholder file route names: a certified copy the mock issued. */
export function mockSelfAccessFileTitle(id: string): string | null {
  ensureSeeded();
  for (const { detail } of applications.values()) {
    if (detail.certifiedCopy.documentId === id) {
      return `Certified copy ${detail.declarationReference} v${String(detail.version)}.pdf`;
    }
  }
  return null;
}

/** A documents client of the mock as `roles` and `subject` (tests). */
export function mockSelfAccessDocumentsClient(
  roles: readonly string[],
  subject = 'mock-officer',
  name = 'Lucy Wambui',
) {
  const payload = Buffer.from(
    JSON.stringify({ sub: subject, name, realm_access: { roles } }),
  ).toString('base64url');
  return createClient<DocumentsPaths>({
    baseUrl: 'http://documents.test',
    headers: { authorization: `Bearer mock.${payload}.signature` },
    fetch: mockSelfAccessDocumentsFetch,
  });
}
