/**
 * In-memory stand-in for the review service's case and clarification endpoints (review.yaml)
 * and the documents service's letter download, used when REVIEW_MOCK is set until the review
 * service implements spec 07a (#174). One store for every caller. Dated relative to when the
 * store was seeded:
 *
 * - Case `mine` (DCI-TSC-2026-0003418-P), held by whoever is signed in (the token's `sub` and
 *   `name`), window open: `issued` (8 days ago), `late` (responded 3 days late, two documents),
 *   `onTime` (responded), `overdue`, `resolved`, `withdrawn` (letter revoked).
 * - Case `windowClosed`, also held by the caller, past its six-month window: `closedWindow`
 *   (responded), so Raise follow-up is disabled.
 * - Case `peters`, held by Peter Mwangi: `petersOverdue`, read-only for everyone else.
 *
 * Only the case's assignee may act; anyone else gets 403. As review.yaml has it: resolve an
 * issued or responded clarification (note 1-2,000 characters; else 409), withdraw an issued one,
 * overdue included (reason 1-1,000 characters; the letter is revoked; else 409), or raise a
 * follow-up (a draft with `followUpOf`; the contract defines no 409 for it). The contract
 * pre-fills a follow-up with the unresolved items; items carry no resolved state, so the mock
 * copies them all. Resolving the last outstanding
 * clarification makes the case ready for determination. Downloads point at
 * `/api/mock-files/{id}` (`routes/api/mock-files.$id.ts`).
 */
import { randomUUID } from 'node:crypto';

import createClient from 'openapi-fetch';

import { isOutstanding } from '../../clarification/labels';
import { isRecord, json, problem, readJson } from '../mock-http';
import type { paths } from './api.gen';
import type { Assignee, CaseDetail, CaseListItem, Clarification } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MOCK_CASE_IDS = {
  mine: 'ca5e0000-0000-4000-8000-000000000001',
  windowClosed: 'ca5e0000-0000-4000-8000-000000000002',
  peters: 'ca5e0000-0000-4000-8000-000000000003',
} as const;

export const MOCK_CLARIFICATION_IDS = {
  issued: 'c1a70000-0000-4000-8000-000000000101',
  late: 'c1a70000-0000-4000-8000-000000000102',
  onTime: 'c1a70000-0000-4000-8000-000000000103',
  overdue: 'c1a70000-0000-4000-8000-000000000104',
  resolved: 'c1a70000-0000-4000-8000-000000000105',
  withdrawn: 'c1a70000-0000-4000-8000-000000000106',
  closedWindow: 'c1a70000-0000-4000-8000-000000000107',
  petersOverdue: 'c1a70000-0000-4000-8000-000000000108',
} as const;

/** Stands for "whoever is signed in" in the seeded assignee. */
const CALLER = '(caller)';
const PETER: Assignee = { subject: 'f7a0c1de-0000-4000-8000-000000000009', name: 'Peter Mwangi' };

type Item = Clarification['items'][number];

const PLOT: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: '1e2d3c4b-0000-4000-8000-000000000001',
  requirement: 'explain-discrepancy',
  text: 'The value of this plot is 150% higher than in your 2024 declaration, but no acquisition or improvement is recorded. Explain the change.',
  label: 'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy',
};
const SACCO: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: null,
  requirement: 'provide-omitted',
  text: 'Your payslip shows a monthly deduction to Mwalimu National SACCO, but no SACCO loan is declared. Provide the loan details.',
  label: 'Liabilities · John Kennedy',
};

interface StoredCase {
  item: CaseListItem;
  /** CALLER, or a fixed officer. */
  holder: Assignee | typeof CALLER;
}

const cases = new Map<string, StoredCase>();
const clarifications = new Map<string, Clarification>();

function at(now: number, days: number): string {
  return new Date(now + days * DAY_MS).toISOString();
}

function caseItem(
  id: string,
  reference: string,
  declarantName: string,
  now: number,
  windowDays: number,
): CaseListItem {
  return {
    id,
    reference,
    declarantName,
    personnelFileNumber: `TSC/${reference.slice(-9, -2)}`,
    type: 'biennial',
    cycleYear: 2026,
    receivedAt: at(now, windowDays - 182),
    windowEndsAt: at(now, windowDays),
    late: false,
    band: 'medium',
    status: 'awaiting-clarification',
    assignee: null,
    openFlags: 2,
    clarification: { open: 0, status: null, dueAt: null },
    currentVersion: 1,
  };
}

function clarification(
  id: string,
  caseId: string,
  n: number,
  items: Item[],
  issuedDaysAgo: number,
  now: number,
  overrides: Partial<Clarification> = {},
): Clarification {
  const issuedAt = at(now, -issuedDaysAgo);
  return {
    id,
    caseId,
    reference: `CLR-TSC-2026-${String(n).padStart(7, '0')}-${'KMPRTX'[n % 6] ?? 'K'}`,
    status: 'issued',
    items,
    issuedAt,
    dueAt: at(Date.parse(issuedAt), 30),
    respondedAt: null,
    responseLate: false,
    resolvedAt: null,
    resolutionNote: null,
    letter: {
      documentId: id.replace('c1a7', 'd0c0'),
      verificationId: `V-${String(n).padStart(4, '0')}-7K2Q`,
      status: 'issued',
    },
    followUpOf: null,
    response: null,
    ...overrides,
  };
}

function response(
  items: Item[],
  submittedAt: string,
  files: string[] = [],
): NonNullable<Clarification['response']> {
  return {
    submittedAt,
    items: items.map((_, index) => ({
      index,
      text:
        index === 0
          ? 'I built a three-bedroom house on the plot between 2024 and 2026 with a SACCO loan. The bill of quantities and the loan statement are attached.'
          : 'The loan is from Mwalimu National SACCO, taken in March 2025. The balance on the statement date is on the attached statement.',
      attachments:
        index === 0
          ? files.map((fileName, k) => ({
              uploadId: `a77a0000-0000-4000-8000-00000000000${String(k + 1)}`,
              fileName,
              sha256: 'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78',
            }))
          : [],
    })),
  };
}

/** A review client answered by this mock, calling as `subject` (tests). */
export function mockReviewClient(subject: string, name: string) {
  return createClient<paths>({
    baseUrl: 'http://review.test',
    headers: { authorization: `Bearer ${mockToken(subject, name)}` },
    fetch: mockReviewFetch,
  });
}

/** Seeds the fixtures with "now" at `now` (tests pass a fixed time). */
export function resetReviewMock(now: number = Date.now()) {
  cases.clear();
  clarifications.clear();
  const C = MOCK_CASE_IDS;
  const K = MOCK_CLARIFICATION_IDS;
  cases.set(C.mine, {
    item: caseItem(C.mine, 'DCI-TSC-2026-0003418-P', 'John Kennedy Otieno', now, 30),
    holder: CALLER,
  });
  cases.set(C.windowClosed, {
    item: caseItem(C.windowClosed, 'DCB-TSC-2026-0001907-M', 'Grace Atieno', now, -5),
    holder: CALLER,
  });
  cases.set(C.peters, {
    item: caseItem(C.peters, 'DCB-TSC-2026-0002210-X', 'Mary Achieng', now, 40),
    holder: PETER,
  });

  const seed = (value: Clarification) => clarifications.set(value.id, value);
  seed(clarification(K.issued, C.mine, 42, [PLOT, SACCO], 8, now));
  const late = clarification(K.late, C.mine, 17, [PLOT, SACCO], 40, now);
  const lateAt = at(Date.parse(late.dueAt ?? ''), 3);
  seed({
    ...late,
    status: 'responded',
    respondedAt: lateAt,
    responseLate: true,
    response: response([PLOT, SACCO], lateAt, ['bill-of-quantities.pdf', 'loan-statement.pdf']),
  });
  const onTimeAt = at(now, -2);
  seed({
    ...clarification(K.onTime, C.mine, 12, [PLOT, SACCO], 12, now),
    status: 'responded',
    respondedAt: onTimeAt,
    response: response([PLOT, SACCO], onTimeAt),
  });
  seed(clarification(K.overdue, C.mine, 21, [SACCO], 33, now, { status: 'overdue' }));
  seed({
    ...clarification(K.resolved, C.mine, 9, [SACCO], 60, now),
    status: 'resolved',
    respondedAt: at(now, -50),
    response: response([SACCO], at(now, -50)),
    resolvedAt: at(now, -44),
    resolutionNote: 'Loan statement matches the payslip deduction.',
  });
  const withdrawn = clarification(K.withdrawn, C.mine, 30, [PLOT], 15, now);
  seed({
    ...withdrawn,
    status: 'withdrawn',
    letter: withdrawn.letter ? { ...withdrawn.letter, status: 'revoked' } : null,
  });
  seed({
    ...clarification(K.closedWindow, C.windowClosed, 5, [SACCO], 25, now),
    status: 'responded',
    respondedAt: at(now, -3),
    response: response([SACCO], at(now, -3)),
  });
  seed(clarification(K.petersOverdue, C.peters, 3, [PLOT], 35, now, { status: 'overdue' }));
  for (const each of cases.values()) refreshCase(each);
}

/** A bearer token the mock reads `sub` and `name` from (tests; unsigned). */
export function mockToken(subject: string, name: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: subject, name })}.`;
}

/** The caller from the token's claims; the mock does not verify it, the service would. */
function callerOf(request: Request): Assignee {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sub?: unknown; name?: unknown };
    return {
      subject: typeof claims.sub === 'string' ? claims.sub : 'unknown',
      name: typeof claims.name === 'string' ? claims.name : 'You',
    };
  } catch {
    return { subject: 'unknown', name: 'You' };
  }
}

function holderOf(stored: StoredCase, caller: Assignee): Assignee {
  return stored.holder === CALLER ? caller : stored.holder;
}

function ofCase(caseId: string): Clarification[] {
  return [...clarifications.values()]
    .filter((each) => each.caseId === caseId)
    .sort((a, b) => (b.issuedAt ?? '9').localeCompare(a.issuedAt ?? '9'));
}

/** Case counts and status from its clarifications (spec: clarified then ready when none open). */
function refreshCase(stored: StoredCase) {
  const open = ofCase(stored.item.id).filter((each) => isOutstanding(each.status));
  const latest = open[0] ?? null;
  stored.item = {
    ...stored.item,
    status: open.length > 0 ? 'awaiting-clarification' : 'ready-for-determination',
    clarification: {
      open: open.length,
      status: latest?.status ?? null,
      dueAt: latest?.dueAt ?? null,
    },
  };
}

async function textField(request: Request, field: string, max: number): Promise<string | null> {
  const body = await readJson(request);
  const value = isRecord(body) ? body[field] : null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) return null;
  return value;
}

function ensureSeeded() {
  if (cases.size === 0) resetReviewMock();
}

export function mockReviewFetch(request: Request): Promise<Response> {
  ensureSeeded();
  return route(request);
}

/** The documents service's `GET /v1/documents/{id}/download`, for clarification letters. */
export function mockDocumentsFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const { pathname } = new URL(request.url);
  const match = /^\/v1\/documents\/([^/]+)\/download$/.exec(pathname);
  const known = [...clarifications.values()].some((each) => each.letter?.documentId === match?.[1]);
  if (request.method !== 'GET' || !match?.[1] || !known) {
    return Promise.resolve(problem(404, 'Not found'));
  }
  return Promise.resolve(
    json(200, {
      downloadUrl: `/api/mock-files/${match[1]}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      sha256: 'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78',
    }),
  );
}

/** What the placeholder file route names: a letter's clarification, or an attachment. */
export function mockFileTitle(id: string): string | null {
  ensureSeeded();
  for (const each of clarifications.values()) {
    if (each.letter?.documentId === id) return `Clarification letter ${each.reference ?? ''}`;
    for (const item of each.response?.items ?? []) {
      const file = item.attachments.find((attachment) => attachment.uploadId === id);
      if (file) return file.fileName;
    }
  }
  return null;
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const caller = callerOf(request);

  const attachment = /^\/v1\/review\/cases\/([^/]+)\/attachments\/([^/]+)\/download$/.exec(
    pathname,
  );
  if (method === 'GET' && attachment?.[1] && attachment[2]) {
    if (!cases.has(attachment[1])) return problem(404, 'Not found');
    return json(200, {
      downloadUrl: `/api/mock-files/${attachment[2]}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }

  const oneCase = /^\/v1\/review\/cases\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && oneCase?.[1]) {
    const stored = cases.get(oneCase[1]);
    return stored ? json(200, detail(stored, caller)) : problem(404, 'Not found');
  }

  const action = /^\/v1\/review\/clarifications\/([^/]+)\/(resolve|follow-up|withdraw)$/.exec(
    pathname,
  );
  if (method === 'POST' && action?.[1] && action[2]) {
    return act(request, action[1], action[2], caller);
  }

  const one = /^\/v1\/review\/clarifications\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && one?.[1]) {
    const found = clarifications.get(one[1]);
    return found ? json(200, found) : problem(404, 'Not found');
  }

  return problem(404, 'Not found');
}

function detail(stored: StoredCase, caller: Assignee): CaseDetail {
  const holder = holderOf(stored, caller);
  return {
    case: { ...stored.item, assignee: holder },
    flags: [],
    clarifications: ofCase(stored.item.id),
    notes: [],
    timeline: [],
    document: null,
    versions: [{ version: 1, submittedAt: stored.item.receivedAt, late: false }],
    reviewerHistory: [holder],
  };
}

async function act(
  request: Request,
  id: string,
  action: string,
  caller: Assignee,
): Promise<Response> {
  const found = clarifications.get(id);
  const stored = found ? cases.get(found.caseId) : undefined;
  if (!found || !stored) return problem(404, 'Not found');
  if (holderOf(stored, caller).subject !== caller.subject) {
    return problem(403, 'Only the officer holding the case can act on its clarifications');
  }

  if (action === 'resolve') {
    if (found.status !== 'issued' && found.status !== 'responded') {
      return problem(409, 'Not issued or responded');
    }
    const note = await textField(request, 'note', 2000);
    if (note === null) return problem(400, 'A note of 1 to 2,000 characters is required');
    return save(stored, {
      ...found,
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolutionNote: note,
    });
  }

  if (action === 'withdraw') {
    if (found.status !== 'issued' && found.status !== 'overdue') {
      return problem(409, 'Not issued');
    }
    const reason = await textField(request, 'reason', 1000);
    if (reason === null) return problem(400, 'A reason of 1 to 1,000 characters is required');
    return save(stored, {
      ...found,
      status: 'withdrawn',
      letter: found.letter ? { ...found.letter, status: 'revoked' } : null,
    });
  }

  // follow-up
  const draft: Clarification = {
    id: randomUUID(),
    caseId: found.caseId,
    reference: null,
    status: 'draft',
    items: found.items,
    issuedAt: null,
    dueAt: null,
    respondedAt: null,
    responseLate: false,
    resolvedAt: null,
    resolutionNote: null,
    letter: null,
    followUpOf: found.id,
    response: null,
  };
  clarifications.set(draft.id, draft);
  return json(201, draft);
}

function save(stored: StoredCase, updated: Clarification): Response {
  clarifications.set(updated.id, updated);
  refreshCase(stored);
  return json(200, updated);
}
