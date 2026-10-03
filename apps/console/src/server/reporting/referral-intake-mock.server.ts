/**
 * The reporting mock's EACC referrals intake (spec 09 S12; reporting.yaml `listReferralIntake`,
 * `pushReferralToIcms`), behind `mock.server.ts`. As the service has it
 * (`services/reporting/src/referrals`):
 *
 * - EACC analysts and supervisors only (403 for anyone else).
 * - The intake, the latest sent first, of one ICMS status or all, cursor paging (50 by default).
 * - Push (Idempotency-Key required, 400 without; a key replays its first answer; 404 for a
 *   referral not in the intake): a registered referral is answered as it is and never sent
 *   again; otherwise ICMS registers it with a case number (`ICMS-2026-<seq>`), or the push fails
 *   (502 `icms-push-failed` with `error`), leaving it `push-failed` with that error until pushed
 *   again. Either way `pushedAt` and `pushedBy` record the caller.
 *
 * Seeded (`MOCK_INTAKE_IDS`) after the prototype (09-form-m, #236): PSC's two-missed-cycles
 * referral, not pushed, which ICMS registers; TSC's unexplained assets, not pushed, whose first
 * push finds ICMS unavailable and whose retry registers it; NPSC's undeclared assets, failed
 * (ICMS did not answer), which a retry registers; the Nairobi City board's unanswered
 * clarification, pushed and waiting for its case number, which a push again registers (ICMS
 * replays it); then 26 registered ones, so the list pages. One store for every caller.
 *
 * Also answers the documents service's download of the referrals' evidence packages
 * (`mockIntakePackageFetch`), with links to `/api/mock-files/{id}` (`routes/api/mock-files.$id.ts`).
 */
import { EACC_ROLES } from '@adili/roles';

import { ICMS_STATUSES } from '../../components/referral-intake/statuses';
import { json, mockCallerOf, problem } from '../mock-http';
import type {
  IcmsPushError,
  IcmsStatus,
  IntakeReferralGrounds,
  ReferralIntakeItem,
  ReportingOfficer,
} from './types';

export const MOCK_INTAKE_IDS = {
  /** PSC, two missed cycles, not pushed: ICMS registers it. */
  notPushed: 'eacc0000-0000-4000-8000-000000000001',
  /** TSC, unexplained assets, not pushed: the first push finds ICMS unavailable, a retry works. */
  failsFirst: 'eacc0000-0000-4000-8000-000000000002',
  /** NPSC, undeclared assets, failed (ICMS did not answer): a retry registers it. */
  failed: 'eacc0000-0000-4000-8000-000000000003',
  /** Nairobi City board, unanswered clarification, pushed and waiting for its case number. */
  pushed: 'eacc0000-0000-4000-8000-000000000004',
  /** PSC, undeclared assets, registered as ICMS-2026-004790. */
  registered: 'eacc0000-0000-4000-8000-000000000005',
} as const;

/** How many referrals the intake is seeded with. */
export const MOCK_INTAKE_SIZE = 30;

const COMMISSIONS: Record<string, string> = {
  psc: 'Public Service Commission',
  tsc: 'Teachers Service Commission',
  jsc: 'Judicial Service Commission',
  parlsc: 'Parliamentary Service Commission',
  npsc: 'National Police Service Commission',
  cpsb047: 'Nairobi City County Public Service Board',
  cpsb001: 'Mombasa County Public Service Board',
  cpsb032: 'Nakuru County Public Service Board',
  cpsb022: 'Kiambu County Public Service Board',
};

const BRIAN: ReportingOfficer = { subject: 'mock-eacc-analyst-brian', name: 'Brian Otieno' };
const ESTHER: ReportingOfficer = { subject: 'mock-eacc-analyst-esther', name: 'Esther Chebet' };

const GROUNDS: IntakeReferralGrounds[] = [
  'undeclared-assets',
  'unexplained-assets',
  'two-missed-cycles',
  'unanswered-clarification',
];

const STATUSES: ReadonlySet<string> = new Set(ICMS_STATUSES);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface Stored {
  item: ReferralIntakeItem;
  /** Pushes still to fail, each with its error, before ICMS registers it. */
  failures: IcmsPushError[];
}

let store = new Map<string, Stored>();
/** Answers by referral and Idempotency-Key: the status and body of the first push with it. */
let replays = new Map<string, { status: number; body: unknown }>();
let nextCaseNumber = 4813;
/** Each evidence package's document id, with its referral's reference. */
let packages = new Map<string, string>();

function packageId(index: number): string {
  return `eacc0000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`;
}

function seedItem(
  index: number,
  fields: Pick<ReferralIntakeItem, 'referralId' | 'reference' | 'grounds' | 'sentAt'> & {
    slug: string;
    icmsStatus?: IcmsStatus;
    icmsCaseNumber?: string;
    icmsRegisteredAt?: string;
    pushedAt?: string;
    pushedBy?: ReportingOfficer;
    error?: IcmsPushError;
  },
): ReferralIntakeItem {
  return {
    referralId: fields.referralId,
    commission: { slug: fields.slug, name: COMMISSIONS[fields.slug] ?? fields.slug },
    reference: fields.reference,
    grounds: fields.grounds,
    cycleYear: 2026,
    sentAt: fields.sentAt,
    packageDocumentId: packageId(index),
    icmsStatus: fields.icmsStatus ?? 'not-pushed',
    icmsCaseNumber: fields.icmsCaseNumber ?? null,
    icmsRegisteredAt: fields.icmsRegisteredAt ?? null,
    pushedAt: fields.pushedAt ?? null,
    pushedBy: fields.pushedBy ?? null,
    error: fields.error ?? null,
  };
}

function seed(): Map<string, Stored> {
  const items: Stored[] = [
    {
      item: seedItem(0, {
        referralId: MOCK_INTAKE_IDS.notPushed,
        slug: 'psc',
        reference: 'RFL-PSC-2026-0000003-7',
        grounds: 'two-missed-cycles',
        sentAt: '2026-09-24T11:10:00Z',
      }),
      failures: [],
    },
    {
      item: seedItem(1, {
        referralId: MOCK_INTAKE_IDS.failsFirst,
        slug: 'tsc',
        reference: 'RFL-TSC-2026-0000041-K',
        grounds: 'unexplained-assets',
        sentAt: '2026-09-22T06:32:00Z',
      }),
      failures: ['icms-unavailable'],
    },
    {
      item: seedItem(2, {
        referralId: MOCK_INTAKE_IDS.failed,
        slug: 'npsc',
        reference: 'RFL-NPSC-2026-0000012-4',
        grounds: 'undeclared-assets',
        sentAt: '2026-09-18T13:45:00Z',
        icmsStatus: 'push-failed',
        pushedAt: '2026-09-25T08:02:00Z',
        pushedBy: BRIAN,
        error: 'icms-unavailable',
      }),
      failures: [],
    },
    {
      item: seedItem(3, {
        referralId: MOCK_INTAKE_IDS.pushed,
        slug: 'cpsb047',
        reference: 'RFL-CPSB047-2026-0000005-R',
        grounds: 'unanswered-clarification',
        sentAt: '2026-09-15T09:20:00Z',
        icmsStatus: 'pushed',
        pushedAt: '2026-09-26T06:58:00Z',
        pushedBy: BRIAN,
      }),
      failures: [],
    },
    {
      item: seedItem(4, {
        referralId: MOCK_INTAKE_IDS.registered,
        slug: 'psc',
        reference: 'RFL-PSC-2026-0000031-B',
        grounds: 'undeclared-assets',
        sentAt: '2026-09-10T08:33:00Z',
        icmsStatus: 'registered',
        icmsCaseNumber: 'ICMS-2026-004790',
        icmsRegisteredAt: '2026-09-12T11:05:00Z',
        pushedAt: '2026-09-12T11:04:48Z',
        pushedBy: BRIAN,
      }),
      failures: [],
    },
  ];
  // Older referrals, registered in ICMS, so the list pages.
  const slugs = ['jsc', 'npsc', 'parlsc', 'cpsb022', 'psc', 'cpsb032', 'tsc', 'cpsb047', 'cpsb001'];
  const checks = '0123456789ACDEFHKMPQRW';
  const named = items.length;
  for (let i = 0; i < MOCK_INTAKE_SIZE - named; i += 1) {
    const slug = slugs[i % slugs.length] ?? 'psc';
    const sent = Date.parse('2026-09-06T09:00:00Z') - (i * 4 + (i % 3)) * 86_400_000;
    const registered = new Date(sent + 86_400_000).toISOString();
    items.push({
      item: seedItem(items.length, {
        referralId: `eacc0000-0000-4000-8000-${String(10 + i).padStart(12, '0')}`,
        slug,
        reference: `RFL-${slug.toUpperCase()}-2026-${String(20 + i).padStart(7, '0')}-${checks[(i * 7) % checks.length] ?? '0'}`,
        grounds: GROUNDS[(i * 5) % GROUNDS.length] ?? 'undeclared-assets',
        sentAt: new Date(sent).toISOString(),
        icmsStatus: 'registered',
        icmsCaseNumber: `ICMS-2026-00${String(4640 - i * 11)}`,
        icmsRegisteredAt: registered,
        pushedAt: registered,
        pushedBy: i % 2 ? BRIAN : ESTHER,
      }),
      failures: [],
    });
  }
  return new Map(items.map((each) => [each.item.referralId, each]));
}

/** Back to the seeded intake; `now` dates the pushes made after (tests fix it). */
let clock: () => number = () => Date.now();

export function resetReferralIntakeMock(now?: number): void {
  store = seed();
  replays = new Map();
  nextCaseNumber = 4813;
  packages = new Map(
    [...store.values()].map(({ item }) => [item.packageDocumentId, item.reference]),
  );
  clock = now === undefined ? () => Date.now() : () => now;
}

function ensureSeeded(): void {
  if (store.size === 0) resetReferralIntakeMock();
}

/** The latest sent first; the cursor is the index of the next row. */
function list(url: URL): Response {
  const status = url.searchParams.get('icmsStatus');
  if (status !== null && !STATUSES.has(status)) {
    return problem(400, 'icmsStatus is not an ICMS status');
  }
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return problem(400, 'limit must be 1 to 100');
  }
  const cursor = url.searchParams.get('cursor');
  const start = cursor === null ? 0 : Number(cursor);
  if (!Number.isInteger(start) || start < 0) {
    return problem(400, 'The cursor is not one this list gave.');
  }
  const rows = [...store.values()]
    .map(({ item }) => item)
    .filter((item) => status === null || item.icmsStatus === status)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const items = rows.slice(start, start + limit);
  return json(200, {
    items,
    nextCursor: start + limit < rows.length ? String(start + limit) : null,
  });
}

function push(referralId: string, key: string | null, caller: ReportingOfficer): Response {
  if (!key || !/^[0-9a-f-]{36}$/i.test(key)) return problem(400, 'Idempotency-Key is required');
  const replayKey = `${referralId} ${key}`;
  const replay = replays.get(replayKey);
  if (replay) return json(replay.status, replay.body);
  const stored = store.get(referralId);
  if (!stored) return problem(404, 'Not in the intake');
  const answer = (status: number, body: unknown) => {
    replays.set(replayKey, { status, body });
    return json(status, body);
  };
  const { item } = stored;
  if (item.icmsStatus === 'registered') return answer(200, item);
  const at = new Date(clock()).toISOString();
  item.pushedAt = at;
  item.pushedBy = caller;
  const failure = stored.failures.shift();
  if (failure) {
    item.icmsStatus = 'push-failed';
    item.error = failure;
    return answer(502, {
      type: 'about:blank',
      title: 'The referral could not be registered with ICMS. Push it again to retry.',
      status: 502,
      code: 'icms-push-failed',
      error: failure,
    });
  }
  item.icmsStatus = 'registered';
  item.error = null;
  item.icmsCaseNumber = `ICMS-2026-00${String(nextCaseNumber)}`;
  nextCaseNumber += 1;
  item.icmsRegisteredAt = at;
  return answer(200, item);
}

/** Answers `/v1/eacc/referrals` and `/v1/eacc/referrals/{id}/push`; null for any other path. */
export function referralIntakeFetch(request: Request): Response | null {
  const url = new URL(request.url);
  const pushMatch = /^\/v1\/eacc\/referrals\/([^/]+)\/push$/.exec(url.pathname);
  if (url.pathname !== '/v1/eacc/referrals' && !pushMatch) return null;
  ensureSeeded();
  const caller = mockCallerOf(request);
  if (!caller.subject) return problem(401, 'Unauthorized');
  if (!EACC_ROLES.some((role) => caller.roles.includes(role))) {
    return problem(403, 'Only EACC analysts and supervisors');
  }
  if (pushMatch?.[1]) {
    if (request.method !== 'POST') return problem(405, 'Method not allowed');
    return push(pushMatch[1], request.headers.get('idempotency-key'), {
      subject: caller.subject,
      name: caller.name ?? caller.subject,
    });
  }
  if (request.method !== 'GET') return problem(405, 'Method not allowed');
  return list(url);
}

/** The placeholder file's title for a seeded evidence package, or null. */
export function mockIntakeFileTitle(documentId: string): string | null {
  ensureSeeded();
  const reference = packages.get(documentId);
  return reference ? `Referral evidence package ${reference}` : null;
}

/**
 * The documents service's download of a referral's evidence package, for an EACC analyst or
 * supervisor (documents authorises EACC roles for referral packages, spec 09 BE-3): a link to
 * the placeholder file route. 403 for anyone else, 404 for a document the intake does not hold.
 */
export function mockIntakePackageFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const match = /^\/v1\/documents\/([^/]+)\/download$/.exec(new URL(request.url).pathname);
  const documentId = match?.[1];
  if (request.method !== 'GET' || !documentId || !packages.has(documentId)) {
    return Promise.resolve(problem(404, 'Not found'));
  }
  const caller = mockCallerOf(request);
  if (!EACC_ROLES.some((role) => caller.roles.includes(role))) {
    return Promise.resolve(problem(403, 'Forbidden'));
  }
  return Promise.resolve(
    json(200, {
      downloadUrl: `/api/mock-files/${documentId}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }),
  );
}
