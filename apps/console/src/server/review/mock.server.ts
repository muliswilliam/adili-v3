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
 * - Case `mine` also has `draft`, saved with one item, which the composer continues.
 *
 * The composer's endpoints (spec 07a #170): create a draft on a case (Idempotency-Key replays
 * the first answer), update it while it is a draft (else 409), and issue it (Idempotency-Key
 * required and replayed): 400 without items, 409 `clarification-window-closed` past the case's
 * window (with `windowEndsAt`), else a CLR reference, due in 30 days, and a letter `pending`
 * for `MOCK_LETTER_DELAY_MS`, then `issued`.
 *
 * Only the case's assignee may act; anyone else gets 403. As review.yaml has it: resolve an
 * issued or responded clarification (note 1-2,000 characters; else 409), withdraw an issued one,
 * overdue included (reason 1-1,000 characters; the letter is revoked; else 409), or raise a
 * follow-up (a draft with `followUpOf`; the contract defines no 409 for it). The contract
 * pre-fills a follow-up with the unresolved items; items carry no resolved state, so the mock
 * copies them all. Resolving the last outstanding
 * clarification makes the case ready for determination. Downloads point at
 * `/api/mock-files/{id}` (`routes/api/mock-files.$id.ts`). The copilot endpoints (spec 07c),
 * and the flags and declaration document of the cases, come from `copilot-mock.server.ts`.
 *
 * A Commission's AI status (`GET /v1/commissions/{slug}/ai-status`, spec 07c) comes from the
 * ai-gateway mock's store, as the service proxies the gateway; the mock does not check roles.
 */
import { randomUUID } from 'node:crypto';

import { addDays } from '@adili/ui';

import createClient from 'openapi-fetch';

import { isOutstanding } from '../../clarification/labels';
import { mockTenantAiStatus } from '../ai-gateway/mock.server';
import { isRecord, json, problem, readJson } from '../mock-http';
import type { paths } from './api.gen';
import { copilotRoute, mockCaseContent, resetCopilotMock } from './copilot-mock.server';
import type { Assignee, CaseDetail, CaseListItem, Clarification, TimelineEntry } from './types';

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
  draft: 'c1a70000-0000-4000-8000-000000000109',
} as const;

/** How long an issued clarification's letter stays `pending` before it reads `issued`. */
export const MOCK_LETTER_DELAY_MS = 4_000;

const REQUIREMENTS: readonly Item['requirement'][] = [
  'provide-omitted',
  'explain-discrepancy',
  'correct',
];

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
  /** Status changes made in this store (the seeded history is not replayed). */
  timeline: TimelineEntry[];
}

const cases = new Map<string, StoredCase>();
const clarifications = new Map<string, Clarification>();
/** When each letter issued here stops being `pending`. */
const letterReadyAt = new Map<string, number>();
/** Answers already given, by method, path and Idempotency-Key. */
const replays = new Map<string, { status: number; body: unknown }>();

function at(now: number, days: number): string {
  return addDays(new Date(now).toISOString(), days);
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

function reference(n: number): string {
  return `CLR-TSC-2026-${String(n).padStart(7, '0')}-${'KMPRTX'[n % 6] ?? 'K'}`;
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
    reference: reference(n),
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
    opening: null,
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
  letterReadyAt.clear();
  replays.clear();
  const C = MOCK_CASE_IDS;
  const K = MOCK_CLARIFICATION_IDS;
  cases.set(C.mine, {
    item: caseItem(C.mine, 'DCI-TSC-2026-0003418-P', 'John Kennedy Otieno', now, 30),
    holder: CALLER,
    timeline: [],
  });
  cases.set(C.windowClosed, {
    item: caseItem(C.windowClosed, 'DCB-TSC-2026-0001907-M', 'Grace Atieno', now, -5),
    holder: CALLER,
    timeline: [],
  });
  cases.set(C.peters, {
    item: caseItem(C.peters, 'DCB-TSC-2026-0002210-X', 'Mary Achieng', now, 40),
    holder: PETER,
    timeline: [],
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
  seed(draftOf(K.draft, C.mine, [PLOT], null));
  for (const each of cases.values()) refreshCase(each);
  resetCopilotMock(now, C);
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

/** A clarification as read now: its letter `issued` once its delay has passed. */
function current(found: Clarification): Clarification {
  const readyAt = letterReadyAt.get(found.id);
  if (readyAt === undefined || Date.now() < readyAt || found.letter?.status !== 'pending') {
    return found;
  }
  letterReadyAt.delete(found.id);
  const ready: Clarification = { ...found, letter: { ...found.letter, status: 'issued' } };
  clarifications.set(ready.id, ready);
  return ready;
}

function draftOf(
  id: string,
  caseId: string,
  items: Item[],
  followUpOf: string | null,
): Clarification {
  return {
    id,
    caseId,
    reference: null,
    status: 'draft',
    items,
    issuedAt: null,
    dueAt: null,
    respondedAt: null,
    responseLate: false,
    resolvedAt: null,
    resolutionNote: null,
    letter: null,
    followUpOf,
    opening: null,
    response: null,
  };
}

function ofCase(caseId: string): Clarification[] {
  return [...clarifications.values()]
    .map(current)
    .filter((each) => each.caseId === caseId)
    .sort((a, b) => (b.issuedAt ?? '9').localeCompare(a.issuedAt ?? '9'));
}

/**
 * Case counts and status from its clarifications. When the last outstanding one closes, the case
 * goes clarified, then ready for determination (spec 07a S15), each a timeline entry by `actor`.
 */
function refreshCase(stored: StoredCase, actor: Assignee | null = null) {
  const open = ofCase(stored.item.id).filter((each) => isOutstanding(each.status));
  const latest = open[0] ?? null;
  const status = open.length > 0 ? 'awaiting-clarification' : 'ready-for-determination';
  if (actor && stored.item.status === 'awaiting-clarification' && status !== stored.item.status) {
    const changedAt = new Date().toISOString();
    for (const [to, summary] of [
      ['clarified', 'Case clarified: no clarification open'],
      ['ready-for-determination', 'Case ready for determination'],
    ] as const) {
      stored.timeline.push({
        id: randomUUID(),
        kind: 'status-changed',
        actor,
        at: changedAt,
        summary,
        ref: to,
      });
    }
  }
  stored.item = {
    ...stored.item,
    status,
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

  const aiStatus = /^\/v1\/commissions\/([^/]+)\/ai-status$/.exec(pathname);
  if (method === 'GET' && aiStatus?.[1]) {
    // The review service proxies the gateway's tenant status; so does the mock (spec 07c).
    return json(200, mockTenantAiStatus(aiStatus[1]));
  }

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

  const copilot = await copilotRoute(request, caller, (caseId) => {
    const stored = cases.get(caseId);
    return stored ? holderOf(stored, caller).subject === caller.subject : null;
  });
  if (copilot) return copilot;

  const drafts = /^\/v1\/review\/cases\/([^/]+)\/clarifications$/.exec(pathname);
  if (method === 'POST' && drafts?.[1]) {
    const caseId = drafts[1];
    return once(request, () => createDraft(request, caseId, caller));
  }

  const issue = /^\/v1\/review\/clarifications\/([^/]+)\/issue$/.exec(pathname);
  if (method === 'POST' && issue?.[1]) {
    const id = issue[1];
    if (!request.headers.get('idempotency-key')) {
      return problem(400, 'Idempotency-Key is required');
    }
    return once(request, () => issueDraft(id, caller));
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
    return found ? json(200, current(found)) : problem(404, 'Not found');
  }
  if (method === 'PUT' && one?.[1]) {
    return updateDraft(request, one[1], caller);
  }

  return problem(404, 'Not found');
}

function detail(stored: StoredCase, caller: Assignee): CaseDetail {
  const holder = holderOf(stored, caller);
  return {
    case: { ...stored.item, assignee: holder },
    ...mockCaseContent(stored.item.id),
    clarifications: ofCase(stored.item.id),
    notes: [],
    timeline: stored.timeline,
    // One version per mock case; the case id stands in for its version id.
    versions: [
      {
        versionId: stored.item.id,
        version: 1,
        submittedAt: stored.item.receivedAt,
        late: false,
        amendment: false,
      },
    ],
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
    return save(
      stored,
      { ...found, status: 'resolved', resolvedAt: new Date().toISOString(), resolutionNote: note },
      caller,
    );
  }

  if (action === 'withdraw') {
    if (found.status !== 'issued' && found.status !== 'overdue') {
      return problem(409, 'Not issued');
    }
    const reason = await textField(request, 'reason', 1000);
    if (reason === null) return problem(400, 'A reason of 1 to 1,000 characters is required');
    return save(
      stored,
      {
        ...found,
        status: 'withdrawn',
        letter: found.letter ? { ...found.letter, status: 'revoked' } : null,
      },
      caller,
    );
  }

  // follow-up
  const draft = {
    ...draftOf(randomUUID(), found.caseId, found.items, found.id),
    opening: found.opening,
  };
  clarifications.set(draft.id, draft);
  return json(201, draft);
}

function save(stored: StoredCase, updated: Clarification, actor: Assignee): Response {
  clarifications.set(updated.id, updated);
  refreshCase(stored, actor);
  return json(200, updated);
}

/**
 * Runs `work` once per method, path and Idempotency-Key; a repeat gets the first answer back.
 * Without a key it runs every time, as review.yaml's optional keys have it.
 */
async function once(request: Request, work: () => Promise<Response>): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) return work();
  const slot = `${request.method} ${new URL(request.url).pathname} ${key}`;
  const seen = replays.get(slot);
  if (seen) return json(seen.status, seen.body);
  const response = await work();
  replays.set(slot, { status: response.status, body: await response.clone().json() });
  return response;
}

/** review.yaml `ClarificationInput`, checked as the service does; null when invalid. */
async function contentOf(
  request: Request,
): Promise<{ items: Item[]; opening: string | null } | null> {
  const body = await readJson(request);
  const items = isRecord(body) ? body.items : null;
  if (!Array.isArray(items) || items.length > 50) return null;
  const opening = isRecord(body) ? (body.opening ?? null) : null;
  if (opening !== null && (typeof opening !== 'string' || opening.trim().length > 800)) {
    return null;
  }
  const valid: Item[] = [];
  const optional = (value: unknown) => (typeof value === 'string' ? value : null);
  for (const item of items) {
    if (!isRecord(item)) return null;
    const { requirement, text } = item;
    if (!REQUIREMENTS.includes(requirement as Item['requirement'])) return null;
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) return null;
    valid.push({
      sectionKey: optional(item.sectionKey),
      personKey: optional(item.personKey),
      itemId: optional(item.itemId),
      requirement: requirement as Item['requirement'],
      text: text.trim(),
    });
  }
  return { items: valid, opening: opening?.trim() || null };
}

async function createDraft(request: Request, caseId: string, caller: Assignee) {
  const stored = cases.get(caseId);
  if (!stored) return problem(404, 'Not found');
  if (holderOf(stored, caller).subject !== caller.subject) {
    return problem(403, 'Only the officer holding the case can write its clarifications');
  }
  const content = await contentOf(request);
  if (content === null) return problem(400, 'Items are not valid');
  const draft = { ...draftOf(randomUUID(), caseId, content.items, null), opening: content.opening };
  clarifications.set(draft.id, draft);
  return json(201, draft);
}

async function updateDraft(request: Request, id: string, caller: Assignee) {
  const found = clarifications.get(id);
  const stored = found ? cases.get(found.caseId) : undefined;
  if (!found || !stored) return problem(404, 'Not found');
  if (holderOf(stored, caller).subject !== caller.subject) {
    return problem(403, 'Only the officer holding the case can write its clarifications');
  }
  if (found.status !== 'draft') return problem(409, 'Not a draft', 'not-a-draft');
  const content = await contentOf(request);
  if (content === null) return problem(400, 'Items are not valid');
  const updated = { ...found, ...content };
  clarifications.set(id, updated);
  return json(200, updated);
}

function issueDraft(id: string, caller: Assignee): Promise<Response> {
  const found = clarifications.get(id);
  const stored = found ? cases.get(found.caseId) : undefined;
  if (!found || !stored) return Promise.resolve(problem(404, 'Not found'));
  if (holderOf(stored, caller).subject !== caller.subject) {
    return Promise.resolve(problem(403, 'Only the officer holding the case can issue'));
  }
  if (found.status !== 'draft') return Promise.resolve(problem(409, 'Not a draft', 'not-a-draft'));
  if (found.items.length === 0) {
    return Promise.resolve(
      json(400, {
        type: 'clarification-has-no-items',
        title: 'Bad Request',
        status: 400,
        detail: 'A clarification needs at least one item to be issued.',
        code: 'clarification-has-no-items',
      }),
    );
  }
  const { windowEndsAt } = stored.item;
  const now = Date.now();
  if (now > Date.parse(windowEndsAt)) {
    return Promise.resolve(
      json(409, {
        type: 'clarification-window-closed',
        title: 'Conflict',
        status: 409,
        detail: 'The Commission could no longer request clarification.',
        code: 'clarification-window-closed',
        windowEndsAt,
      }),
    );
  }
  const numbers = [...clarifications.values()].map((each) =>
    Number(/-(\d{7})-/.exec(each.reference ?? '')?.[1] ?? 0),
  );
  const n = Math.max(0, ...numbers) + 1;
  const issuedAt = new Date(now).toISOString();
  const issued: Clarification = {
    ...found,
    reference: reference(n),
    status: 'issued',
    issuedAt,
    dueAt: at(now, 30),
    letter: {
      documentId: randomUUID(),
      verificationId: `V-${String(n).padStart(4, '0')}-7K2Q`,
      status: 'pending',
    },
  };
  letterReadyAt.set(id, now + MOCK_LETTER_DELAY_MS);
  stored.timeline.push({
    id: randomUUID(),
    kind: 'clarification-issued',
    actor: caller,
    at: issuedAt,
    summary: `Clarification ${issued.reference ?? ''} issued`,
    ref: id,
  });
  return Promise.resolve(save(stored, issued, caller));
}
