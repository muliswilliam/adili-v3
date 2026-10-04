/**
 * In-memory stand-in for the review service's declarant clarification endpoints (review.yaml),
 * used when REVIEW_MOCK is set until the service implements them (#174). Every signed-in caller
 * shares one store and sees the same clarifications, from the Teachers Service Commission on
 * declaration DCI-TSC-2026-0003418-P, dated relative to when the store was seeded:
 *
 * - `open`: issued 8 days ago, two points (S14, S20).
 * - `reminder`: issued 22 days ago, so the day-20 reminder has gone (8 days left).
 * - `overdue`: issued 33 days ago, not answered; a response is still accepted, marked late.
 * - `late`: responded 3 days after the due date, with a document.
 * - `answered`: responded on time; `further` follows it up and is open.
 * - `resolved` and `withdrawn` (letter revoked as issued in error).
 * - `history1` to `history3`: resolved months ago on the 2024 biennial declaration
 *   DCB-TSC-2024-0001207-3, so the list has a second page of earlier clarifications.
 *
 * A response needs an `Idempotency-Key` (a replay returns the first answer) and must answer
 * every point; attachments must be clean `clarification-attachment` uploads in the documents
 * mock (409 `attachment-not-clean`). A second response is 409 `already-responded`; one to a
 * withdrawn or resolved clarification is 409 `not-open`. Letters download from
 * `/api/mock-letters/{id}` (`routes/api/mock-letters.$id.ts`).
 *
 * Decisions (spec 08, S17): `nonCompliant`, the 2024 biennial declaration's, decided a year ago
 * with its letter; `noIssues`, a 2022 bulk closure ("compliant: no issues identified") whose letter
 * is issued on its first request, after `MOCK_LETTER_ISSUE_MS`, as the service renders it then.
 * Letters download from `/api/mock-letters/{documentId}` too.
 *
 * Tests can reseed at a given time (`resetReviewMock`) and make the next response fail as if the
 * service were down (`failNextResponse`), or the next decision letter (`failNextDecisionLetter`).
 */
import { addDays } from '@adili/ui';

import { mockUpload } from '../documents/mock.server';
import { isRecord, json, problem, readJson } from '../mock-http';
import { noticeInStore, noticesRoute, resetNoticesMock } from './notices-mock.server';
import type { DeclarantClarification, DeclarantDecision } from './types';

const RESPONSE_DAYS = 30;

export const MOCK_CLARIFICATION_IDS = {
  open: 'c1a70000-0000-4000-8000-000000000001',
  reminder: 'c1a70000-0000-4000-8000-000000000002',
  overdue: 'c1a70000-0000-4000-8000-000000000003',
  late: 'c1a70000-0000-4000-8000-000000000004',
  answered: 'c1a70000-0000-4000-8000-000000000005',
  further: 'c1a70000-0000-4000-8000-000000000006',
  resolved: 'c1a70000-0000-4000-8000-000000000007',
  withdrawn: 'c1a70000-0000-4000-8000-000000000008',
  history1: 'c1a70000-0000-4000-8000-000000000009',
  history2: 'c1a70000-0000-4000-8000-00000000000a',
  history3: 'c1a70000-0000-4000-8000-00000000000b',
} as const;

const CASE_ID = 'ca5e0000-0000-4000-8000-000000000001';
const COMMISSION = { slug: 'tsc', name: 'Teachers Service Commission' };
const DECLARATION_REFERENCE = 'DCI-TSC-2026-0003418-P';
const BIENNIAL_REFERENCE = 'DCB-TSC-2024-0001207-3';

type Item = DeclarantClarification['items'][number];

const PLOT: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: '1e2d3c4b-0000-4000-8000-000000000001',
  requirement: 'explain-discrepancy',
  text: 'The value of this plot is 150% higher than in your 2024 declaration, but no acquisition or improvement is recorded. Explain the change.',
  label: 'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy',
  aiJobId: null,
  aiLanguage: null,
};
const SACCO: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: null,
  requirement: 'provide-omitted',
  text: 'Your payslip shows a monthly deduction to Mwalimu National SACCO, but no SACCO loan is declared. Provide the loan details.',
  label: 'Liabilities · John Kennedy',
  aiJobId: null,
  aiLanguage: null,
};
const VEHICLE: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: '1e2d3c4b-0000-4000-8000-000000000002',
  requirement: 'correct',
  text: 'The registration number KDA 123A does not match the vehicle described. Correct the entry.',
  label: 'Assets · Toyota Axio KDA 123A · John Kennedy',
  aiJobId: null,
  aiLanguage: null,
};

export const MOCK_DECISION_IDS = {
  nonCompliant: 'de7e0000-0000-4000-8000-000000000101',
  noIssues: 'de7e0000-0000-4000-8000-000000000102',
} as const;

/** How long a bulk closure's letter takes to issue on its first request. */
export const MOCK_LETTER_ISSUE_MS = 1_500;

interface StoredDecision extends DeclarantDecision {
  documentId: string;
}

const clarifications = new Map<string, DeclarantClarification>();
const decisions = new Map<string, StoredDecision>();
let failNextLetter = false;
let issueDelayMs = MOCK_LETTER_ISSUE_MS;
/** First answer by Idempotency-Key, replayed on retry. */
const answered = new Map<string, Response>();
let failNext = false;

function at(now: number, days: number): string {
  return addDays(new Date(now).toISOString(), days);
}

function sequence(n: number): string {
  return `CLR-TSC-2026-${String(n).padStart(7, '0')}-${'KMPRTX'[n % 6] ?? 'K'}`;
}

function clarification(
  id: string,
  n: number,
  items: Item[],
  issuedDaysAgo: number,
  now: number,
  overrides: Partial<DeclarantClarification> = {},
): DeclarantClarification {
  const issuedAt = at(now, -issuedDaysAgo);
  return {
    id,
    caseId: CASE_ID,
    reference: sequence(n),
    status: 'issued',
    items,
    issuedAt,
    dueAt: at(Date.parse(issuedAt), RESPONSE_DAYS),
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
    openingAiJobId: null,
    openingAiLanguage: null,
    language: 'en',
    response: null,
    commission: COMMISSION,
    declarationReference: DECLARATION_REFERENCE,
    letterDownloadUrl: `/api/mock-letters/${id}`,
    ...overrides,
  };
}

function responded(
  items: Item[],
  submittedAt: string,
  attachments: { fileName: string }[] = [],
): NonNullable<DeclarantClarification['response']> {
  return {
    submittedAt,
    items: items.map((_, index) => ({
      index,
      text:
        index === 0
          ? 'I built a three-bedroom house on the plot between 2024 and 2026 with a SACCO loan. The bill of quantities and the loan statement are attached.'
          : 'The loan is from Mwalimu National SACCO, taken in March 2025. The balance on the statement date was shown on the attached statement.',
      attachments: index === 0 ? attachments.map((file, k) => attachment(file.fileName, k)) : [],
    })),
  };
}

function attachment(fileName: string, k: number) {
  return {
    uploadId: `a77a0000-0000-4000-8000-00000000000${String(k + 1)}`,
    fileName,
    sha256: 'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78',
  };
}

/** Clears responses and seeds the fixtures with "now" at `now` (tests pass a fixed time). */
export function resetReviewMock(
  now: number = Date.now(),
  {
    letterIssueMs = MOCK_LETTER_ISSUE_MS,
    noNotices = false,
  }: { letterIssueMs?: number; noNotices?: boolean } = {},
) {
  resetNoticesMock(now, { empty: noNotices });
  issueDelayMs = letterIssueMs;
  decisions.clear();
  failNextLetter = false;
  decisions.set(MOCK_DECISION_IDS.nonCompliant, {
    determinationId: MOCK_DECISION_IDS.nonCompliant,
    declarationReference: BIENNIAL_REFERENCE,
    commission: COMMISSION,
    outcome: 'non-compliant',
    decidedAt: at(now, -340),
    reference: 'CMP-TSC-2024-0004102-U',
    letterAvailable: true,
    documentId: 'd0c00000-0000-4000-8000-000000000101',
  });
  decisions.set(MOCK_DECISION_IDS.noIssues, {
    determinationId: MOCK_DECISION_IDS.noIssues,
    declarationReference: 'DCB-TSC-2022-0000815-M',
    commission: COMMISSION,
    outcome: 'compliant-no-issues',
    decidedAt: at(now, -1060),
    reference: 'CMP-TSC-2023-0118204-M',
    letterAvailable: false,
    documentId: 'd0c00000-0000-4000-8000-000000000102',
  });
  clarifications.clear();
  answered.clear();
  failNext = false;
  const ids = MOCK_CLARIFICATION_IDS;
  const seed = (value: DeclarantClarification) => clarifications.set(value.id, value);

  seed(clarification(ids.open, 42, [PLOT, SACCO], 8, now));
  seed(clarification(ids.reminder, 38, [VEHICLE], 22, now));
  seed(clarification(ids.overdue, 21, [SACCO], 33, now, { status: 'overdue' }));

  const late = clarification(ids.late, 17, [PLOT, SACCO], 40, now);
  const lateAt = at(Date.parse(late.dueAt ?? ''), 3);
  seed({
    ...late,
    status: 'responded',
    respondedAt: lateAt,
    responseLate: true,
    response: responded([PLOT, SACCO], lateAt, [{ fileName: 'bill-of-quantities.pdf' }]),
  });

  const onTime = clarification(ids.answered, 12, [PLOT, SACCO], 20, now);
  const onTimeAt = at(now, -9);
  seed({
    ...onTime,
    status: 'responded',
    respondedAt: onTimeAt,
    response: responded([PLOT, SACCO], onTimeAt, [{ fileName: 'loan-statement.pdf' }]),
  });
  seed(
    clarification(
      ids.further,
      45,
      [
        {
          ...SACCO,
          text: 'The loan statement you attached is for 2024. Provide the statement for the year ending on your statement date.',
        },
      ],
      2,
      now,
      { followUpOf: ids.answered },
    ),
  );

  const resolved = clarification(ids.resolved, 9, [VEHICLE], 60, now);
  seed({
    ...resolved,
    status: 'resolved',
    respondedAt: at(now, -50),
    response: responded([VEHICLE], at(now, -50)),
    resolvedAt: at(now, -44),
    resolutionNote: 'Registration corrected in the response.',
  });

  const history: [string, number, Item[], number, boolean][] = [
    [ids.history1, 5, [PLOT, SACCO], 140, true],
    [ids.history2, 4, [VEHICLE], 160, false],
    [ids.history3, 2, [SACCO], 200, true],
  ];
  for (const [id, n, items, issuedDaysAgo, late] of history) {
    const old = clarification(id, n, items, issuedDaysAgo, now, {
      declarationReference: BIENNIAL_REFERENCE,
    });
    const respondedAt = at(Date.parse(old.dueAt ?? ''), late ? 6 : -10);
    seed({
      ...old,
      status: 'resolved',
      respondedAt,
      responseLate: late,
      response: responded(items, respondedAt),
      resolvedAt: at(Date.parse(respondedAt), 14),
      resolutionNote: 'Response accepted.',
    });
  }

  const withdrawn = clarification(ids.withdrawn, 30, [VEHICLE], 15, now);
  seed({
    ...withdrawn,
    status: 'withdrawn',
    letter: withdrawn.letter ? { ...withdrawn.letter, status: 'revoked' } : null,
  });
}

/** The next decision letter answers 502, as if documents could not issue it (tests). */
export function failNextDecisionLetter() {
  failNextLetter = true;
}

/** The decision a letter's document id belongs to (the letter route). */
export function mockDecisionLetter(documentId: string): DeclarantDecision | undefined {
  ensureSeeded();
  return [...decisions.values()].find((each) => each.documentId === documentId);
}

async function decisionLetterOf(id: string): Promise<Response> {
  const found = decisions.get(id);
  if (!found) return problem(404, 'Not found');
  if (failNextLetter) {
    failNextLetter = false;
    return problem(502, 'The documents service refused the letter');
  }
  if (!found.letterAvailable) {
    // A bulk closure's letter is rendered on its first request.
    await new Promise((resolve) => setTimeout(resolve, issueDelayMs));
    found.letterAvailable = true;
  }
  return json(200, {
    documentId: found.documentId,
    verificationId: `V${found.documentId.slice(-8).toUpperCase()}`,
    downloadUrl: `/api/mock-letters/${found.documentId}`,
  });
}

/** The next response answers 503, as if the service were down (tests). */
export function failNextResponse() {
  failNext = true;
}

/** A clarification as the mock holds it (the letter route and tests). */
export function mockClarification(id: string): DeclarantClarification | undefined {
  ensureSeeded();
  return clarifications.get(id);
}

/** A notice as the mock holds it (the letter route and tests). */
export function mockNotice(actionId: string) {
  ensureSeeded();
  return noticeInStore(actionId);
}

function ensureSeeded() {
  if (clarifications.size === 0) resetReviewMock();
}

export function mockReviewFetch(request: Request): Promise<Response> {
  ensureSeeded();
  return route(request);
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  const notices = await noticesRoute(request);
  if (notices) return notices;
  if (method === 'GET' && pathname === '/v1/me/decisions') {
    return json(
      200,
      [...decisions.values()].map((each): DeclarantDecision => ({
        determinationId: each.determinationId,
        declarationReference: each.declarationReference,
        commission: each.commission,
        outcome: each.outcome,
        decidedAt: each.decidedAt,
        reference: each.reference,
        letterAvailable: each.letterAvailable,
      })),
    );
  }

  const letter = /^\/v1\/review\/determinations\/([^/]+)\/letter$/.exec(pathname);
  if (method === 'GET' && letter?.[1]) return decisionLetterOf(letter[1]);

  if (method === 'GET' && pathname === '/v1/me/clarifications') {
    const list = [...clarifications.values()]
      .filter((each) => each.status !== 'draft')
      .sort((a, b) => (b.issuedAt ?? '').localeCompare(a.issuedAt ?? ''));
    return json(200, list);
  }

  const response = /^\/v1\/me\/clarifications\/([^/]+)\/response$/.exec(pathname);
  if (method === 'POST' && response?.[1]) return respond(request, response[1]);

  const one = /^\/v1\/me\/clarifications\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && one?.[1]) {
    const found = clarifications.get(one[1]);
    return found && found.status !== 'draft' ? json(200, found) : problem(404, 'Not found');
  }

  return problem(404, 'Not found');
}

async function respond(request: Request, id: string): Promise<Response> {
  const key = request.headers.get('Idempotency-Key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  const replay = answered.get(key);
  if (replay) return replay.clone();

  if (failNext) {
    failNext = false;
    return problem(503, 'Service unavailable');
  }

  const found = clarifications.get(id);
  if (!found || found.status === 'draft') return problem(404, 'Not found');
  if (found.status === 'responded') {
    return problem(409, 'A response was already submitted', 'already-responded');
  }
  if (found.status !== 'issued' && found.status !== 'overdue') {
    return problem(409, 'This clarification is not open', 'not-open');
  }

  const body = await readJson(request);
  const items = isRecord(body) && Array.isArray(body.items) ? (body.items as unknown[]) : null;
  const parsed = items?.map(parseItem) ?? [];
  if (parsed.length !== found.items.length || parsed.some((item, i) => item?.index !== i)) {
    return problem(400, 'Answer every point once, in order');
  }

  const answers: NonNullable<DeclarantClarification['response']>['items'] = [];
  for (const item of parsed) {
    if (!item) return problem(400, 'Invalid response');
    const files = [];
    for (const uploadId of item.attachments) {
      const upload = mockUpload(uploadId);
      if (upload?.state !== 'clean' || upload.purpose !== 'clarification-attachment') {
        return problem(409, 'An attachment is not a clean upload', 'attachment-not-clean');
      }
      files.push({
        uploadId,
        fileName: upload.fileName ?? 'Document',
        sha256: upload.sha256 ?? '',
      });
    }
    answers.push({ index: item.index, text: item.text, attachments: files });
  }

  const now = new Date().toISOString();
  const updated: DeclarantClarification = {
    ...found,
    status: 'responded',
    respondedAt: now,
    responseLate: Date.parse(now) > Date.parse(found.dueAt ?? now),
    response: { submittedAt: now, items: answers },
  };
  clarifications.set(id, updated);
  const reply = json(201, updated);
  answered.set(key, reply.clone());
  return reply;
}

function parseItem(value: unknown): { index: number; text: string; attachments: string[] } | null {
  if (!isRecord(value)) return null;
  const { index, text, attachments } = value;
  if (typeof index !== 'number' || typeof text !== 'string') return null;
  if (!text.trim() || text.length > 2000) return null;
  if (!Array.isArray(attachments) || attachments.length > 10) return null;
  if (!attachments.every((each) => typeof each === 'string')) return null;
  return { index, text, attachments };
}
