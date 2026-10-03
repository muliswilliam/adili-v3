/**
 * In-memory stand-in for the review service's declarant notice endpoints (review.yaml
 * `getMyNotices`, `respondToNotice`), part of the portal's review mock (REVIEW_MOCK). The
 * Teachers Service Commission's notices to John Kennedy, dated relative to when the store was
 * seeded:
 *
 * - `warning`: a warning for unanswered clarification CLR-TSC-2026-0000519-L (due 19 days ago),
 *   issued 2 days ago, act within 12 days.
 * - `noticeResponded`: the notice before it, issued 16 days ago, answered 10 days ago with a
 *   document; followed by the warning.
 * - `noticeOpen`: a notice to comply for the biennial declaration, issued 5 days ago, 9 days
 *   left, not answered: the respond form.
 * - `complied`: a notice from last cycle, closed when the declaration was filed.
 *
 * `salary` (#208, `REVIEW_MOCK_SALARY` in development) carries the clarification's ladder on:
 * `stopped` adds the salary stoppage issued 6 days ago, payroll having stopped the salary;
 * `disciplinary` also the disciplinary referral issued yesterday; `reinstating` closes the
 * ladder as complied, the reinstatement not yet confirmed by payroll; `reinstated` has payroll's
 * confirmation from yesterday. `none` (the default) stops at the warning.
 *
 * A response needs an `Idempotency-Key` (a replay returns the first answer), 1 to 4,000
 * characters and up to 10 clean `action-response` uploads from the documents mock (409
 * `attachment-not-clean` / `attachment-not-accepted`). A second response is 409
 * `already-responded`; one to a closed notice (complied, cancelled) or to a later step is 409
 * `notice-closed`. `resetReviewMock` seeds these with the clarifications. Letters download from `/api/mock-letters/{actionId}`.
 */
import { addDays } from '@adili/ui';

import { mockUpload } from '../documents/mock.server';
import type { Env } from '../env.server';
import { isRecord, json, problem, readJson } from '../mock-http';
import type { components } from './schema.gen';

type Notice = components['schemas']['DeclarantNotice'];

export const MOCK_NOTICE_IDS = {
  warning: 'ac710000-0000-4000-8000-0000000a0001',
  noticeResponded: 'ac710000-0000-4000-8000-0000000a0002',
  noticeOpen: 'ac710000-0000-4000-8000-0000000a0003',
  complied: 'ac710000-0000-4000-8000-0000000a0004',
} as const;

/** The salary stoppage and disciplinary referral notices `salary` seeds (#208). */
export const MOCK_SALARY_NOTICE_IDS = {
  stoppage: 'ac710000-0000-4000-8000-0000000a0005',
  disciplinary: 'ac710000-0000-4000-8000-0000000a0006',
} as const;

/** How far the clarification's ladder has gone with the declarant's salary (#208). */
export type MockSalary = Env['REVIEW_MOCK_SALARY'];

const COMMISSION = { slug: 'tsc', name: 'Teachers Service Commission' };

/** The ladders the notices belong to: one per subject. */
const LADDERS = {
  clarification: 'add10000-0000-4000-8000-0000000a0001',
  filing: 'add10000-0000-4000-8000-0000000a0002',
  filing2024: 'add10000-0000-4000-8000-0000000a0003',
} as const;

const notices = new Map<string, Notice>();
const answered = new Map<string, Response>();
let failNext = false;

function at(now: number, days: number): string {
  return addDays(new Date(now).toISOString(), days);
}

function notice(
  actionId: string,
  step: Notice['step'],
  whatToDo: Notice['whatToDo'],
  reference: string,
  issuedDaysAgo: number,
  now: number,
  overrides: Partial<Notice> = {},
): Notice {
  const issuedAt = at(now, -issuedDaysAgo);
  return {
    actionId,
    ...(whatToDo === 'respond-to-clarification'
      ? {
          ladderId: LADDERS.clarification,
          subject: {
            kind: 'clarification' as const,
            reference: 'CLR-TSC-2026-0000519-L',
            dueAt: at(now, -19),
          },
        }
      : {
          ladderId: LADDERS.filing,
          subject: { kind: 'obligation' as const, reference: 'biennial:2026', dueAt: null },
        }),
    windowDays: 14,
    commission: COMMISSION,
    step,
    status: 'issued',
    issuedAt,
    actBy: addDays(issuedAt, 14),
    whatToDo,
    reference,
    letterDownloadUrl: `/api/mock-letters/${actionId}`,
    response: null,
    salaryStoppedAt: null,
    salaryReinstatedAt: null,
    ...overrides,
  };
}

/** Clears responses and seeds the notices with "now" at `now` (tests pass a fixed time). */
export function resetNoticesMock(
  now: number = Date.now(),
  { empty = false, salary = 'none' }: { empty?: boolean; salary?: MockSalary } = {},
) {
  notices.clear();
  answered.clear();
  failNext = false;
  if (empty) return;
  const ids = MOCK_NOTICE_IDS;
  const seed = (value: Notice) => notices.set(value.actionId, value);

  seed(
    notice(ids.warning, 'warning', 'respond-to-clarification', 'ADM-TSC-2026-0000301-L', 2, now),
  );
  seed(
    notice(
      ids.noticeResponded,
      'notice-to-comply',
      'respond-to-clarification',
      'ADM-TSC-2026-0000233-D',
      16,
      now,
      {
        status: 'responded',
        response: {
          text: 'I was admitted at Moi Teaching and Referral Hospital from 12 August to 9 September and did not see the SMS. I attach my discharge summary. I will respond to the clarification this week.',
          attachments: [
            {
              uploadId: 'a77a0000-0000-4000-8000-0000000a0001',
              fileName: 'MTRH discharge summary.pdf',
            },
          ],
          submittedAt: at(now, -10),
        },
      },
    ),
  );
  seed(
    notice(
      ids.noticeOpen,
      'notice-to-comply',
      'file-declaration',
      'ADM-TSC-2026-0000412-U',
      5,
      now,
    ),
  );
  seed(
    notice(
      ids.complied,
      'notice-to-comply',
      'file-declaration',
      'ADM-TSC-2024-0000187-K',
      300,
      now,
      {
        status: 'complied',
        ladderId: LADDERS.filing2024,
        subject: { kind: 'obligation', reference: 'biennial:2024', dueAt: null },
      },
    ),
  );
  if (salary !== 'none') seedSalary(now, salary);
}

/** The clarification's ladder carried on to the salary stoppage and beyond (#208). */
function seedSalary(now: number, salary: Exclude<MockSalary, 'none'>) {
  const ids = { ...MOCK_NOTICE_IDS, ...MOCK_SALARY_NOTICE_IDS };
  const closed = salary === 'reinstating' || salary === 'reinstated';
  const stoppedAt = at(now, -6);
  const update = (id: string, change: Partial<Notice>) => {
    const found = notices.get(id);
    if (found) notices.set(id, { ...found, ...change });
  };
  // The ladder dated back: notice answered, warning ignored, salary stopped 6 days ago.
  update(ids.noticeResponded, { issuedAt: at(now, -36), actBy: at(now, -22) });
  const responded = notices.get(ids.noticeResponded)?.response;
  if (responded)
    update(ids.noticeResponded, { response: { ...responded, submittedAt: at(now, -30) } });
  update(ids.warning, { issuedAt: at(now, -21), actBy: at(now, -7) });
  notices.set(
    ids.stoppage,
    notice(
      ids.stoppage,
      'salary-stoppage',
      'respond-to-clarification',
      'ADM-TSC-2026-0000358-0',
      6,
      now,
      {
        actBy: addDays(stoppedAt, 30),
        salaryStoppedAt: stoppedAt,
        ...(salary === 'reinstated'
          ? { status: 'reinstated', salaryReinstatedAt: at(now, -1) }
          : salary === 'reinstating'
            ? { status: 'complied' }
            : {}),
      },
    ),
  );
  if (salary === 'disciplinary') {
    notices.set(
      ids.disciplinary,
      notice(
        ids.disciplinary,
        'disciplinary-referral',
        'respond-to-clarification',
        'ADM-TSC-2026-0000402-B',
        1,
        now,
        { actBy: null },
      ),
    );
  }
  if (closed) {
    update(ids.warning, { status: 'complied' });
    update(ids.noticeResponded, { status: 'complied' });
  }
}

/** The next response answers 503, as if the service were down (tests). */
export function failNextNoticeResponse() {
  failNext = true;
}

/** A notice as the mock holds it (the letter route and tests); seeded by the review mock. */
export function noticeInStore(actionId: string): Notice | undefined {
  return notices.get(actionId);
}

/** Answers the notice endpoints, or null for any other request (the review mock routes on). */
export async function noticesRoute(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (request.method === 'GET' && pathname === '/v1/me/notices') {
    const list = [...notices.values()].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    return json(200, list);
  }
  const response = /^\/v1\/me\/notices\/([^/]+)\/response$/.exec(pathname);
  if (request.method === 'POST' && response?.[1]) return respond(request, response[1]);
  return null;
}

async function respond(request: Request, actionId: string): Promise<Response> {
  const key = request.headers.get('Idempotency-Key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  const replay = answered.get(key);
  if (replay) return replay.clone();
  if (failNext) {
    failNext = false;
    return problem(503, 'Service unavailable');
  }
  const found = notices.get(actionId);
  if (!found) return problem(404, 'Not found');
  if (found.response) return problem(409, 'A response was already submitted', 'already-responded');
  if (
    found.status !== 'issued' ||
    (found.step !== 'notice-to-comply' && found.step !== 'warning')
  ) {
    return problem(409, 'This notice is closed', 'notice-closed');
  }
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.text !== 'string' || !Array.isArray(body.attachments)) {
    return problem(400, 'Invalid response');
  }
  const text = body.text.trim();
  if (!text || text.length > 4000 || body.attachments.length > 10) {
    return problem(400, 'Invalid response');
  }
  const files = [];
  for (const uploadId of body.attachments) {
    if (typeof uploadId !== 'string') return problem(400, 'Invalid response');
    const upload = mockUpload(uploadId);
    if (upload?.purpose !== 'action-response') {
      return problem(409, 'An attachment is not accepted here', 'attachment-not-accepted');
    }
    if (upload.state !== 'clean') {
      return problem(409, 'An attachment is not a clean upload', 'attachment-not-clean');
    }
    files.push({ uploadId, fileName: upload.fileName ?? 'Document' });
  }
  const updated: Notice = {
    ...found,
    status: 'responded',
    response: { text, attachments: files, submittedAt: new Date().toISOString() },
  };
  notices.set(actionId, updated);
  const reply = json(201, updated);
  answered.set(key, reply.clone());
  return reply;
}
