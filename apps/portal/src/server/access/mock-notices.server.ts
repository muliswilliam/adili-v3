/**
 * In-memory stand-in for the access service's declarant endpoints (access.yaml
 * `listMyAccessNotices`, `submitRepresentations`), used when ACCESS_MOCK is set; `mock.server.ts`
 * routes `/v1/me/access-notices` here for callers with the `declarant` realm role. Every
 * declarant shares one store, seeded relative to when it was first used with a request in each
 * state the declarant can see:
 *
 * - notified 2 days ago, waiting for a response (5 days left);
 * - notified 7 days ago, window closing in a few hours. Saving on it answers 409
 *   `representations-closed`, as when the window closes while the declarant is writing;
 * - window closed without a response, and window closed with an objection (under decision);
 * - partially granted after an objection with a document, denied, granted after consent;
 * - withdrawn by the applicant after the declarant added context;
 * - a law-enforcement agency granted access, and another granted part of what it asked. A
 *   law-enforcement notice carries the agency, its case reference, the outcome and its dates
 *   only, never the agency's reason or the scope.
 *
 * Saving within the window keeps the first `submittedAt`; `consent` puts the request under
 * decision and closes the window. The text `Unavailable` answers 503, as when the access or key
 * service is down. Saves take about as long as the service would (the mock's latency).
 */
import { addDays } from '@adili/ui';
import { ARQ, format, LEA } from '@adili/numbering/references';

import { mockUpload } from '../documents/mock.server';
import { isRecord, json, problem, readJson } from '../mock-http';
import type {
  Decision,
  DeclarantNotice,
  FormKDeclarantNotice,
  LeaDeclarantNotice,
  Representations,
  RepresentationStance,
  Scope,
} from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOW_DAYS = 7;
const TSC = { slug: 'tsc', name: 'Teachers Service Commission' };
const ALL: Scope['sections'] = ['bio', 'income', 'assets', 'liabilities', 'other'];

const notices = new Map<string, DeclarantNotice>();
/** Requests whose window "closes" when the declarant saves (409). */
const closeOnSave = new Set<string>();
const answered = new Map<string, { status: number; body: unknown }>();
let seeded = false;

/** Fixed ids, so tests and screenshots can open each state. */
export const MOCK_NOTICE_IDS = {
  awaiting: 'b7e10000-0000-4000-8000-000000000001',
  closing: 'b7e10000-0000-4000-8000-000000000002',
  closedNone: 'b7e10000-0000-4000-8000-000000000003',
  closedObjected: 'b7e10000-0000-4000-8000-000000000004',
  partial: 'b7e10000-0000-4000-8000-000000000005',
  denied: 'b7e10000-0000-4000-8000-000000000006',
  granted: 'b7e10000-0000-4000-8000-000000000007',
  withdrawn: 'b7e10000-0000-4000-8000-000000000008',
  lea: 'b7e10000-0000-4000-8000-000000000009',
  leaPartial: 'b7e10000-0000-4000-8000-000000000010',
  /** Served on paper before the declarant had an account; their letter entered by the officer. */
  inWriting: 'b7e10000-0000-4000-8000-000000000011',
} as const;

const scope = (
  years: number[],
  includeSpouses: boolean,
  includeChildren: boolean,
  sections: Scope['sections'],
): Scope => ({ years, includeSpouses, includeChildren, sections });

const OBJECTION =
  'The plot is the subject of a pending case at the Environment and Land Court in Nakuru. Releasing my land and loan details now could affect that case. My income is already public through the TSC salary scales.';

function reference(sequence: number, scheme = ARQ): string {
  return format(scheme, { issuer: 'TSC', period: 2026, sequence });
}

function decision(
  outcome: Decision['outcome'],
  decidedAt: string,
  reasons: string,
  extra: Partial<Decision> = {},
): Decision {
  return {
    outcome,
    grantedScope: null,
    grounds: [],
    reasons,
    decidedBy: { subject: 'access-officer', name: 'Access officer' },
    decidedAt,
    ...extra,
  };
}

function sent(
  stance: RepresentationStance,
  text: string,
  at: string,
  attachments: Representations['attachments'] = [],
  receivedInWriting = false,
): Representations {
  return {
    stance,
    text,
    attachments,
    submittedAt: at,
    updatedAt: at,
    receivedInWriting,
    recordedBy: null,
  };
}

function seed(now: number) {
  const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * HOUR).toISOString();
  const notice = (
    id: string,
    sequence: number,
    notifiedAt: string,
    fields: Partial<FormKDeclarantNotice>,
  ): FormKDeclarantNotice => ({
    requestId: id,
    reference: reference(sequence),
    kind: 'form-k',
    commission: TSC,
    status: 'under-decision',
    applicantName: 'Wanjiru Kamau',
    purposeInGeneralTerms: 'Journalistic research on school procurement in Nakuru County',
    scope: scope([2026], true, false, ['income', 'assets', 'liabilities']),
    notifiedAt,
    windowEndsAt: addDays(notifiedAt, WINDOW_DAYS),
    canRespond: false,
    representations: null,
    decision: null,
    noticeChannel: 'online',
    ...fields,
  });
  const lea = (
    id: string,
    sequence: number,
    decidedAt: string,
    fields: Pick<LeaDeclarantNotice, 'agency' | 'caseReference' | 'outcome'>,
  ): LeaDeclarantNotice => ({
    requestId: id,
    reference: reference(sequence, LEA),
    kind: 'lea',
    commission: TSC,
    status: 'granted',
    decidedAt,
    // The declarant hears of a grant shortly after it.
    notifiedAt: new Date(Date.parse(decidedAt) + HOUR).toISOString(),
    noticeChannel: 'online',
    ...fields,
  });
  const ids = MOCK_NOTICE_IDS;
  const list: DeclarantNotice[] = [
    notice(ids.awaiting, 52, ago(2, 3), {
      status: 'awaiting-representations',
      canRespond: true,
    }),
    notice(ids.closing, 50, ago(WINDOW_DAYS, -3), {
      status: 'awaiting-representations',
      canRespond: true,
      applicantName: 'Daniel Ochieng Otieno',
      purposeInGeneralTerms: 'A tenant’s claim over rent paid to a school staff housing scheme',
      scope: scope([2025, 2026], false, false, ['income', 'assets']),
    }),
    notice(ids.inWriting, 51, ago(4, 9), {
      status: 'awaiting-representations',
      noticeChannel: 'written',
      canRespond: true,
      applicantName: 'Peter Kiprono Langat',
      purposeInGeneralTerms: 'Reporting on bursary allocations by school boards in Nakuru',
      scope: scope([2026], false, false, ['income', 'assets']),
      representations: sent(
        'object',
        'I received the Commission’s letter on my return from leave. The bursary funds were never in my account: they were paid to the schools directly by the county.',
        ago(2, 6),
        [
          {
            uploadId: 'c0de0000-0000-4000-8000-000000000010',
            fileName: 'Letter to the Commission, scanned.pdf',
          },
        ],
        true,
      ),
    }),
    notice(ids.closedNone, 47, ago(9), {
      applicantName: 'Grace Njeri Mwangi',
      purposeInGeneralTerms: 'Academic research on declarations by school heads',
      scope: scope([2026], false, false, ['income']),
    }),
    notice(ids.closedObjected, 45, ago(11), {
      applicantName: 'Kevin Mutua Njoroge',
      purposeInGeneralTerms: 'Civil claim over a land sale in Rongai',
      scope: scope([2026], true, true, ['income', 'assets', 'liabilities', 'other']),
      representations: sent('object', OBJECTION, ago(8), [
        {
          uploadId: 'c0de0000-0000-4000-8000-000000000001',
          fileName: 'ELC case 118 of 2026 hearing notice.pdf',
        },
      ]),
    }),
    notice(ids.partial, 39, ago(48), {
      status: 'partially-granted',
      applicantName: 'Joseph Maina Kariuki',
      purposeInGeneralTerms: 'Suspected conflict of interest in a supplies contract',
      scope: scope([2025, 2026], true, true, ALL),
      representations: sent(
        'object',
        'I had no role in the supplies contract. It was awarded by the county education office.',
        ago(45),
        [
          {
            uploadId: 'c0de0000-0000-4000-8000-000000000002',
            fileName: 'Tender committee minutes.pdf',
          },
        ],
      ),
      decision: decision(
        'partial-grant',
        ago(30),
        'The contract concerns the officer’s school, so his income and assets are relevant. His liabilities and his family’s details are not needed for it.',
        {
          grantedScope: scope([2026], false, false, ['income', 'assets']),
          grounds: ['not-objectives'],
        },
      ),
    }),
    notice(ids.denied, 31, ago(80), {
      status: 'denied',
      applicantName: 'Samuel Otieno Ouma',
      purposeInGeneralTerms: 'A private dispute with the officer',
      scope: scope([2025], true, true, ALL),
      decision: decision(
        'deny',
        ago(64),
        'The application concerns a private dispute and gives no reason connected to the officer’s public duties.',
        { grounds: ['frivolous-vexatious'] },
      ),
    }),
    notice(ids.granted, 27, ago(110), {
      status: 'granted',
      applicantName: 'Achieng Odhiambo',
      purposeInGeneralTerms: 'Academic research on declarations by public officers',
      scope: scope([2025], false, false, ['income', 'assets']),
      representations: sent('consent', '', ago(109)),
      decision: decision(
        'grant',
        ago(96),
        'The research purpose is legitimate and the officer consented.',
        {
          grantedScope: scope([2025], false, false, ['income', 'assets']),
        },
      ),
    }),
    notice(ids.withdrawn, 21, ago(130), {
      status: 'withdrawn',
      applicantName: 'Brian Kiptoo Rotich',
      purposeInGeneralTerms: 'Checking a tender award at the school',
      scope: scope([2025], false, false, ['income', 'assets']),
      representations: sent(
        'context',
        'I was not on the tender committee for the 2025 works. The committee minutes are with the Board of Management.',
        ago(128),
      ),
    }),
    lea(ids.lea, 7, ago(26, 1), {
      agency: { code: 'ARA', name: 'Asset Recovery Agency' },
      caseReference: 'ARA/INV/2026/014',
      outcome: 'grant',
    }),
    lea(ids.leaPartial, 4, ago(140), {
      agency: { code: 'DCI', name: 'Directorate of Criminal Investigations' },
      caseReference: 'DCI/ECU/2026/0331',
      outcome: 'partial-grant',
    }),
  ];
  notices.clear();
  closeOnSave.clear();
  answered.clear();
  for (const each of list) notices.set(each.requestId, each);
  closeOnSave.add(ids.closing);
  seeded = true;
}

/** Clears the store and seeds it again as of `now`; for tests. */
export function resetNoticesMock(now = Date.now()) {
  seed(now);
}

/** Every notice, latest notified first, as the service lists them. */
function list(): DeclarantNotice[] {
  if (!seeded) seed(Date.now());
  return [...notices.values()].sort((a, b) => b.notifiedAt.localeCompare(a.notifiedAt));
}

const STANCES = new Set(['object', 'consent', 'context']);

function save(id: string, body: unknown, key: string | null): Response {
  if (key) {
    const replay = answered.get(key);
    if (replay) return json(replay.status, replay.body);
  }
  const found = notices.get(id);
  // A law-enforcement grant takes no representations: the service knows no such Form K request.
  if (found?.kind !== 'form-k') return problem(404, 'No such request about the declarant');
  if (
    !isRecord(body) ||
    typeof body.stance !== 'string' ||
    !STANCES.has(body.stance) ||
    typeof body.text !== 'string' ||
    body.text.length > 8000 ||
    (body.stance !== 'consent' && !body.text.trim()) ||
    !Array.isArray(body.attachments)
  ) {
    return json(400, {
      type: 'about:blank',
      title: 'Invalid body',
      status: 400,
      errors: [{ path: 'text', message: 'is required' }],
    });
  }
  if (body.text.includes('Unavailable')) return problem(503, 'The key service is unavailable');
  const now = new Date();
  if (closeOnSave.has(id) || !found.canRespond) {
    found.canRespond = false;
    found.status = 'under-decision';
    if (closeOnSave.has(id)) found.windowEndsAt = now.toISOString();
    return problem(409, 'The window has closed', 'representations-closed');
  }
  const at = now.toISOString();
  const stance = body.stance as RepresentationStance;
  found.representations = {
    stance,
    text: body.text.trim(),
    attachments: (body.attachments as unknown[]).map((uploadId, index) => ({
      uploadId: String(uploadId),
      fileName:
        found.representations?.attachments.find((file) => file.uploadId === uploadId)?.fileName ??
        mockUpload(String(uploadId))?.fileName ??
        `Document ${String(index + 1)}.pdf`,
    })),
    submittedAt: found.representations?.submittedAt ?? at,
    updatedAt: at,
    // Saved online by the declarant now, whoever entered the previous ones.
    receivedInWriting: false,
    recordedBy: null,
  };
  if (stance === 'consent') {
    found.status = 'under-decision';
    found.canRespond = false;
  }
  if (key) answered.set(key, { status: 200, body: found });
  return json(200, found);
}

/** The notices as they stand, for the history mock to build the register from. */
export function mockNotices(): DeclarantNotice[] {
  return list();
}

export async function mockNoticesFetch(
  request: Request,
  path: string,
  settle: () => Promise<unknown>,
): Promise<Response> {
  if (!seeded) seed(Date.now());
  if (request.method === 'GET' && path === '/v1/me/access-notices') return json(200, list());
  const representing = /^\/v1\/me\/access-notices\/([^/]+)\/representations$/.exec(path);
  if (request.method === 'PUT' && representing?.[1]) {
    const body = await readJson(request);
    await settle();
    return save(representing[1], body, request.headers.get('idempotency-key'));
  }
  return problem(404, 'Not in the access mock');
}
