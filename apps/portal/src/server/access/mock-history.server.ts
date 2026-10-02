/**
 * In-memory stand-in for the access service's "who accessed my declaration" and certified copy
 * endpoints (access.yaml `getMyAccessHistory`, `requestCertifiedCopy`, `listMyCertifiedCopies`,
 * `getMyCertifiedCopy`), used when ACCESS_MOCK is set; `mock.server.ts` routes them here for
 * callers with the `declarant` realm role.
 *
 * The history is built from the declarant notices mock (`mock-notices.server.ts`) as the service
 * builds it from the register, with its visibility rules: a Form K request from notification
 * (notified, the declarant's response, the decision, the package, the applicant's downloads, the
 * end of the download window, withdrawal) and a law enforcement request from the grant
 * (decision, package, downloads, expiry). Staff are never named; the applicant is named on their
 * own downloads and withdrawal. Each issued certified copy adds a `self-access` entry. A
 * response saved on a notice shows at once.
 *
 * Certified copies: two are seeded (one the declarant asked for online, one an access officer
 * recorded for their representative, Mary Kennedy) for a declaration the declarations mock does
 * not hold. Asking for a copy of a version answers 202 `pending`; it is `issued` about three
 * seconds later, with the version's reference from the declarations mock, or `failed` when the
 * declarations mock holds no such version of the caller (as the service fails a copy when
 * declarations has none). The first copy asked for of a superseded version fails once, as when
 * documents is down, so Try again shows; asking again works. Asking again for a version returns
 * its copy (a failed one is tried again).
 *
 * It also answers the documents service's `GET /v1/documents/{id}/download` for issued copies
 * (the declarant downloads them as their subject), with a link to `/api/mock-packages/{id}`.
 */
import { DCI, format } from '@adili/numbering/references';

import { COMMISSIONS } from '../declarations/mock/fixtures';
import { bearerClaims } from '../declarations/mock/obligations';
import { store } from '../declarations/mock/store';
import { isRecord, json, problem, readJson } from '../mock-http';
import { placeholderPdf } from '../mock-pdf';
import { mockNotices } from './mock-notices.server';
import type { AccessHistoryEntry, CertifiedCopy, DeclarantNotice } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The default download window of a Commission's policy (access.packageDownloadDays). */
const PACKAGE_DAYS = 14;
/** How long the mock takes to issue a copy. */
const ISSUE_MS = 3000;

interface MockCopy extends CertifiedCopy {
  /** When a pending copy is issued (or fails). */
  readyAt: number;
  /** The caller who asked, so issuing can check the version is theirs. */
  owner: string | null;
  /** Fails once when it comes due, as when documents is down. */
  failOnce: boolean;
  representativeName: string | null;
}

const copies = new Map<string, MockCopy>();
/** First answer by Idempotency-Key, replayed on retry. */
const answered = new Map<string, { status: number; body: unknown }>();
/** Superseded versions whose first copy already failed once. */
const failedOnce = new Set<string>();
let seeded = false;

/** Fixed ids, so tests and screenshots can find the seeded copies. */
export const MOCK_COPY_IDS = {
  online: 'c0c10000-0000-4000-8000-000000000001',
  representative: 'c0c10000-0000-4000-8000-000000000002',
} as const;

const SEEDED_DECLARATION = 'd0c10000-0000-4000-8000-000000000001';
const TSC = { slug: 'tsc', name: 'Teachers Service Commission' };

function seed(now: number) {
  copies.clear();
  answered.clear();
  failedOnce.clear();
  const reference = format(DCI, { issuer: 'TSC', period: 2026, sequence: 3418 });
  const issued = (
    id: string,
    version: number,
    daysAgo: number,
    representativeName: string | null,
  ): MockCopy => {
    const at = new Date(now - daysAgo * DAY).toISOString();
    return {
      id,
      commission: TSC,
      declarationId: SEEDED_DECLARATION,
      version,
      reference,
      status: 'issued',
      documentId: id.replace(/^c0c1/, 'd0c1'),
      verificationId: `CC${id.slice(-4)}`,
      requestedAt: new Date(Date.parse(at) - 2 * MINUTE).toISOString(),
      issuedAt: at,
      readyAt: 0,
      owner: null,
      failOnce: false,
      representativeName,
    };
  };
  for (const copy of [
    issued(MOCK_COPY_IDS.online, 2, 115, null),
    issued(MOCK_COPY_IDS.representative, 1, 49, 'Mary Kennedy'),
  ]) {
    copies.set(copy.id, copy);
  }
  seeded = true;
}

/** Clears the copies and seeds them again as of `now`; for tests. */
export function resetHistoryMock(now = Date.now()) {
  seed(now);
}

/** The version the declarations mock holds for this caller, if any. */
function filedVersion(owner: string | null, declarationId: string, version: number) {
  const stored = store.get(declarationId);
  if (stored?.owner !== owner) return undefined;
  return stored.versions.find((each) => each.version === version);
}

/** Issues (or fails) a pending copy whose time has come. */
function settle(copy: MockCopy, now: number) {
  if (copy.status !== 'pending' || now < copy.readyAt) return;
  if (copy.failOnce) {
    copy.failOnce = false;
    copy.status = 'failed';
    return;
  }
  const filed = filedVersion(copy.owner, copy.declarationId, copy.version);
  if (!filed) {
    copy.status = 'failed';
    return;
  }
  copy.status = 'issued';
  copy.reference = filed.reference;
  copy.documentId = copy.id.replace(/^.{4}/, 'd0c2');
  copy.verificationId = `CC${copy.id.slice(-6).toUpperCase()}`;
  copy.issuedAt = new Date(copy.readyAt).toISOString();
}

/** The copy as the service answers with it, without the mock's bookkeeping. */
function view(copy: MockCopy): CertifiedCopy {
  const { id, commission, declarationId, version, reference, status } = copy;
  const { documentId, verificationId, requestedAt, issuedAt } = copy;
  return {
    id,
    commission,
    declarationId,
    version,
    reference,
    status,
    documentId,
    verificationId,
    requestedAt,
    issuedAt,
  };
}

function allCopies(now: number): MockCopy[] {
  for (const copy of copies.values()) settle(copy, now);
  return [...copies.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

const COMMISSION_SLUG = /^[a-z][a-z0-9]{1,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestCopy(request: Request, body: unknown, now: number): Response {
  const key = request.headers.get('idempotency-key');
  if (key) {
    const replay = answered.get(key);
    if (replay) return json(replay.status, replay.body);
  }
  if (
    !isRecord(body) ||
    typeof body.commission !== 'string' ||
    !COMMISSION_SLUG.test(body.commission) ||
    typeof body.declarationId !== 'string' ||
    !UUID.test(body.declarationId) ||
    typeof body.version !== 'number' ||
    !Number.isInteger(body.version) ||
    body.version < 1
  ) {
    return json(400, { type: 'about:blank', title: 'Invalid body', status: 400 });
  }
  const { commission, declarationId, version } = body;
  const owner = bearerClaims(request)?.person_id ?? null;
  const name = Object.values(COMMISSIONS).find((each) => each.slug === commission)?.name;
  if (!name) return problem(404, 'No such Commission');
  let copy = [...copies.values()].find(
    (each) => each.declarationId === declarationId && each.version === version,
  );
  if (copy?.status === 'failed') {
    copy.status = 'pending';
    copy.readyAt = now + ISSUE_MS;
  }
  if (!copy) {
    const versionKey = `${declarationId}:${String(version)}`;
    const superseded = filedVersion(owner, declarationId, version)?.supersededAt != null;
    const failOnce = superseded && !failedOnce.has(versionKey);
    if (failOnce) failedOnce.add(versionKey);
    copy = {
      id: crypto.randomUUID(),
      commission: { slug: commission, name },
      declarationId,
      version,
      reference: null,
      status: 'pending',
      documentId: null,
      verificationId: null,
      requestedAt: new Date(now).toISOString(),
      issuedAt: null,
      readyAt: now + ISSUE_MS,
      owner,
      failOnce,
      representativeName: null,
    };
    copies.set(copy.id, copy);
  }
  const answer = view(copy);
  if (key) answered.set(key, { status: 202, body: answer });
  return json(202, answer);
}

/** The history entries a notice gives, as the service's register would hold them. */
function noticeEntries(notice: DeclarantNotice, now: number): AccessHistoryEntry[] {
  const base = {
    subjectKind: notice.kind === 'lea' ? ('lea-request' as const) : ('access-request' as const),
    subjectId: notice.requestId,
    reference: notice.reference,
    commission: notice.commission,
    requester: notice.applicantName,
    caseReference: notice.kind === 'lea' ? 'ARA/INV/118/2026' : null,
    certifiedCopy: null,
  };
  const entries: AccessHistoryEntry[] = [];
  const add = (
    kind: AccessHistoryEntry['kind'],
    at: string,
    summary: string,
    extra: Partial<AccessHistoryEntry> = {},
  ) => {
    entries.push({
      ...base,
      // Unique per notice and entry, uuid-shaped: the notice's first and last groups kept.
      id: `${notice.requestId.slice(0, 19)}${String(entries.length + 1).padStart(4, '0')}-${notice.requestId.slice(-12)}`,
      kind,
      at,
      summary,
      actor: null,
      outcome: null,
      ...extra,
    });
  };
  const lea = notice.kind === 'lea';
  if (!lea) add('notified', notice.notifiedAt, 'Declarant notified');
  const sent = notice.representations;
  if (!lea && sent) {
    add('representations', sent.submittedAt, 'Representations received');
    if (sent.updatedAt !== sent.submittedAt) {
      add('representations', sent.updatedAt, 'Representations received');
    }
  }
  if (notice.status === 'withdrawn') {
    const at = sent ? Date.parse(sent.updatedAt) + 2 * DAY : Date.parse(notice.notifiedAt) + DAY;
    add('withdrawn', new Date(at).toISOString(), 'Request withdrawn', {
      actor: notice.applicantName,
    });
  }
  const { decision } = notice;
  if (decision) {
    add('decided', decision.decidedAt, 'Decision recorded', { outcome: decision.outcome });
    if (decision.outcome !== 'deny') {
      const issuedAt = Date.parse(decision.decidedAt) + 4 * MINUTE;
      add('package-issued', new Date(issuedAt).toISOString(), 'Package issued');
      const downloadedAt = issuedAt + DAY - 3 * HOUR;
      if (downloadedAt < now) {
        add('downloaded', new Date(downloadedAt).toISOString(), 'Package downloaded', {
          actor: lea ? null : notice.applicantName,
        });
      }
      const expiresAt = issuedAt + PACKAGE_DAYS * DAY;
      if (expiresAt < now)
        add('expired', new Date(expiresAt).toISOString(), 'Download window closed');
    }
  }
  return entries;
}

function copyEntry(copy: MockCopy): AccessHistoryEntry | null {
  if (copy.status !== 'issued' || !copy.issuedAt || !copy.reference) return null;
  return {
    id: copy.id.replace(/^.{4}/, 'e0c1'),
    kind: 'self-access',
    at: copy.issuedAt,
    actor: null,
    summary: 'Certified copy issued',
    reference: copy.reference,
    subjectKind: 'self-access',
    subjectId: copy.id,
    commission: copy.commission,
    requester: null,
    caseReference: null,
    outcome: null,
    certifiedCopy: {
      id: copy.id,
      declarationId: copy.declarationId,
      version: copy.version,
      documentId: copy.documentId,
      representativeName: copy.representativeName,
    },
  };
}

function history(now: number): AccessHistoryEntry[] {
  return [
    ...mockNotices().flatMap((notice) => noticeEntries(notice, now)),
    ...allCopies(now).flatMap((copy) => copyEntry(copy) ?? []),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

/** The issued copy whose document this is, if any. */
function copyOfDocument(documentId: string): MockCopy | undefined {
  return allCopies(Date.now()).find(
    (copy) => copy.status === 'issued' && copy.documentId === documentId,
  );
}

/** The placeholder PDF the mock's copy link serves, or null for no such copy. */
export function mockCopyFile(documentId: string): { fileName: string; pdf: string } | null {
  const copy = copyOfDocument(documentId);
  if (!copy?.reference) return null;
  return {
    fileName: `certified-copy-${copy.reference}-v${String(copy.version)}.pdf`,
    pdf: placeholderPdf([
      'CERTIFIED COPY (mock)',
      `${copy.reference} · version ${String(copy.version)}`,
      copy.commission.name,
    ]),
  };
}

/** Documents' `GET /v1/documents/{id}/download` for a certified copy, as its subject. */
export function mockCopyDownload(documentId: string): Response | null {
  if (!copyOfDocument(documentId)) return null;
  return json(200, {
    downloadUrl: `/api/mock-packages/${documentId}`,
    expiresAt: new Date(Date.now() + 5 * MINUTE).toISOString(),
    sha256: '0'.repeat(64),
  });
}

/** Whether the mock answers this path for the declarant. */
export function isHistoryPath(path: string): boolean {
  return path === '/v1/me/access-history' || path.startsWith('/v1/me/certified-copies');
}

export async function mockHistoryFetch(
  request: Request,
  path: string,
  wait: () => Promise<unknown>,
): Promise<Response> {
  if (!seeded) seed(Date.now());
  const now = Date.now();
  if (request.method === 'GET' && path === '/v1/me/access-history') {
    return json(200, history(now));
  }
  if (path === '/v1/me/certified-copies') {
    if (request.method === 'GET') return json(200, allCopies(now).map(view));
    if (request.method === 'POST') {
      const body = await readJson(request);
      await wait();
      return requestCopy(request, body, Date.now());
    }
  }
  const one = /^\/v1\/me\/certified-copies\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && one?.[1]) {
    const copy = copies.get(one[1]);
    if (!copy) return problem(404, 'No such certified copy of yours');
    settle(copy, now);
    return json(200, view(copy));
  }
  return problem(404, 'Not in the access mock');
}
