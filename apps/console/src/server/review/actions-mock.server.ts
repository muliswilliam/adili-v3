/**
 * In-memory stand-in for the review service's administrative action ladder endpoints (review.yaml
 * `listEnforcementLadders`, `getLadder`, `approveAction`, `declineAction`, `restartLadder`), part
 * of the review mock (REVIEW_MOCK). The Teachers Service Commission's ladders, dated relative to
 * when the store was seeded:
 *
 * - `noticeProposed`: a notice to comply the system drafted yesterday for an overdue initial
 *   declaration, waiting for approval.
 * - `noticeResponded`: a notice for an unanswered clarification, issued 12 days ago (2 days
 *   left), with the declarant's response and two documents.
 * - `warningBlocked`: the notice issued 18 days ago went unanswered, the warning is drafted; the
 *   signed-in officer held the clarification's case, so the rule refuses them.
 * - `warningIssued`: notice done, the warning's window runs 9 more days.
 * - `stoppageProposed`: notice and warning issued, the salary stoppage drafted (supervisors only).
 * - `payrollPending` (#208): the salary stoppage approved yesterday; payroll has not acknowledged
 *   the stop-salary instruction, so it is `approved-pending-payroll` and has no letter yet.
 * - `disciplinaryProposed` (#208): an unanswered clarification; the salary stopped (payroll
 *   acknowledged) and its window over, the disciplinary referral drafted (supervisors only).
 * - `reinstated` (#208): the declarant filed while the salary was stopped; payroll acknowledged
 *   the reinstatement.
 * - `declined`: the notice declined with a note, so a supervisor may restart the ladder.
 * - `complied`: the declarant filed while the notice ran.
 * - `ended`: the clarification was withdrawn, so its ladder ended without compliance.
 * - Eighteen more (`filler`), so the list has a second page.
 *
 * As the service: approving or declining is for review staff who did not propose the step and,
 * on a clarification's ladder, never held its case (403 `separation-of-duties`, with `reason`);
 * the salary stoppage and the disciplinary referral are for supervisors (403
 * `supervisor-required`); a step not proposed is 409 `not-proposed`. Approval allocates the ADM
 * number and issues the letter at once (the service's workflow issues it a moment later); a
 * decline ends the ladder; a supervisor restarts a declined ladder (409 `ladder-not-declined`
 * otherwise) and the declined step is drafted again. Approve requires an `Idempotency-Key`;
 * every decision replays the first answer for a key. Letters download through the documents
 * client (`mockActionDocumentsFetch`) from `/api/mock-files/{documentId}`. `actionApprovals` lists
 * the drafted steps in the approvals inbox mock.
 */
import { REVIEWER, SUPERVISOR } from '@adili/roles';

import { isGraveStep, LADDER_WINDOW_DAYS } from '../../actions/ladder';
import { isRecord, json, type MockCaller, problem, readJson } from '../mock-http';
import type { components } from './api.gen';
import type { MockApprovalSource } from './approvals-mock.server';

type Schemas = components['schemas'];
type Ladder = Schemas['Ladder'];
type Action = Schemas['AdministrativeAction'];
type Assignee = Schemas['Assignee'];
type Step = Schemas['ActionStep'];

const DAY = 86_400_000;
const TENANT = 'tsc';
const ISSUER = 'TSC';

export const MOCK_LADDER_IDS = {
  noticeProposed: '1add0000-0000-4000-8000-000000000001',
  noticeResponded: '1add0000-0000-4000-8000-000000000002',
  warningBlocked: '1add0000-0000-4000-8000-000000000003',
  warningIssued: '1add0000-0000-4000-8000-000000000004',
  stoppageProposed: '1add0000-0000-4000-8000-000000000005',
  declined: '1add0000-0000-4000-8000-000000000006',
  complied: '1add0000-0000-4000-8000-000000000007',
  ended: '1add0000-0000-4000-8000-000000000008',
  payrollPending: '1add0000-0000-4000-8000-000000000009',
  disciplinaryProposed: '1add0000-0000-4000-8000-00000000000a',
  reinstated: '1add0000-0000-4000-8000-00000000000b',
} as const;

export const MOCK_LADDER_OFFICERS = {
  samuel: { subject: 'f7a0c1de-0000-4000-8000-000000000021', name: 'Samuel Njoroge' },
  mercy: { subject: 'f7a0c1de-0000-4000-8000-000000000010', name: 'Mercy Wambui' },
  peter: { subject: 'f7a0c1de-0000-4000-8000-000000000009', name: 'Peter Mwangi' },
  kevin: { subject: 'f7a0c1de-0000-4000-8000-000000000022', name: 'Kevin Omondi' },
} as const satisfies Record<string, Assignee>;
const { samuel: SAMUEL, mercy: MERCY, peter: PETER, kevin: KEVIN } = MOCK_LADDER_OFFICERS;

/** Stands for "whoever is signed in" among a ladder's reviewers of record. */
const CALLER = '(caller)';

interface StoredLadder {
  ladder: Ladder;
  /** Who held the case of a clarification's ladder (none for an obligation's); CALLER for whoever is signed in. */
  reviewersOfRecord: string[];
}

const ladders = new Map<string, StoredLadder>();
/** First answer by Idempotency-Key, replayed on retry. */
const replies = new Map<string, Response>();
/** Letter titles by document id, for the placeholder file route. */
const letters = new Map<string, string>();
const attachments = new Map<string, string>();
let sequence = 400;
let clock = { seeded: 0, real: 0 };

/** The mock's "now": the seeded time, moving on with the real clock. */
function now(): number {
  return clock.seeded + (Date.now() - clock.real);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function nextReference(): string {
  sequence += 1;
  const check = '0123456789ABCDEFGHJKLMNPQRTUVWXY'[(sequence * 7) % 32] ?? 'K';
  return `ADM-${ISSUER}-${String(new Date(now()).getUTCFullYear())}-${String(sequence).padStart(7, '0')}-${check}`;
}

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, '0');
}

function actionId(ladder: number, n: number): string {
  return `ac710000-0000-4000-8000-${hex(ladder, 8)}${hex(n, 4)}`;
}

function letterOf(id: string, reference: string, step: Step): Action['letter'] {
  const documentId = id.replace(/^ac71/, 'd0c1');
  letters.set(documentId, `${STEP_TITLES[step]} ${reference}`);
  return { documentId, verificationId: `ADL-${reference.slice(-9, -2)}-Q3FD` };
}

const STEP_TITLES: Record<Step, string> = {
  'notice-to-comply': 'Notice to comply',
  warning: 'Warning',
  'salary-stoppage': 'Salary stoppage',
  'disciplinary-referral': 'Disciplinary referral',
};

function blank(id: string, ladderId: string, step: Step, proposedAt: number): Action {
  return {
    id,
    ladderId,
    step,
    status: 'proposed',
    proposerKind: 'system',
    proposer: null,
    proposedAt: iso(proposedAt),
    approver: null,
    approvedAt: null,
    declinedBy: null,
    declinedAt: null,
    declineNote: null,
    issuedAt: null,
    windowEndsAt: null,
    reference: null,
    letter: null,
    response: null,
    payrollStop: null,
    payrollResume: null,
  };
}

/** A step drafted `proposedDaysAgo`, approved and issued `issuedDaysAgo` by `approver`. */
function issued(
  id: string,
  ladderId: string,
  step: Step,
  proposedDaysAgo: number,
  issuedDaysAgo: number,
  approver: Assignee,
  base: number,
): Action {
  const reference = nextReference();
  const issuedAt = base - issuedDaysAgo * DAY;
  const window = LADDER_WINDOW_DAYS[step];
  return {
    ...blank(id, ladderId, step, base - proposedDaysAgo * DAY),
    status: 'issued',
    approver,
    approvedAt: iso(issuedAt),
    issuedAt: iso(issuedAt),
    windowEndsAt: window === null ? null : iso(issuedAt + window * DAY),
    reference,
    letter: letterOf(id, reference, step),
  };
}

/** Payroll's acknowledgement of an instruction, received at `receivedAt` (ms). */
function acknowledged(
  instructionReference: string,
  action: 'stop_salary' | 'resume_salary',
  payrollReference: string,
  receivedAt: number,
): NonNullable<Action['payrollStop']> {
  return {
    instructionReference,
    action,
    status: 'accepted',
    payrollReference,
    receivedAt: iso(receivedAt),
  };
}

/** An issued salary stoppage whose stop-salary instruction payroll acknowledged on issue. */
function stopped(action: Action, payrollReference: string): Action {
  const { reference, issuedAt } = action;
  if (!reference || !issuedAt) return action;
  return {
    ...action,
    payrollStop: acknowledged(reference, 'stop_salary', payrollReference, Date.parse(issuedAt)),
  };
}

interface LadderSeed {
  id: string;
  subjectKind: Ladder['subjectKind'];
  subjectReference: string;
  declarantName: string;
  personnelFileNumber: string;
  startedDaysAgo: number;
}

function ladderOf(seed: LadderSeed, steps: Action[], base: number): Ladder {
  const current = steps.at(-1);
  return {
    id: seed.id,
    subjectKind: seed.subjectKind,
    subjectId: seed.id.replace(/^1add/, '5b1e'),
    subjectReference: seed.subjectReference,
    declarantName: seed.declarantName,
    personnelFileNumber: seed.personnelFileNumber,
    status: 'active',
    closingCause: null,
    currentStep: current?.step ?? null,
    steps,
    startedAt: iso(base - seed.startedDaysAgo * DAY),
    endedAt: null,
  };
}

function store(ladder: Ladder, reviewersOfRecord: StoredLadder['reviewersOfRecord'] = []) {
  ladders.set(ladder.id, { ladder, reviewersOfRecord });
}

/** Days ago the fillers' warnings were drafted: clear of the inbox's 7 and 30-day bands. */
const FILLER_DRAFTED_DAYS = [1, 4, 10, 13, 16, 19];

const FILLER_NAMES = [
  ['Joseph Kiprono Rotich', '20131145'],
  ['Esther Wanjiku Kamau', '20140288'],
  ['Daniel Otieno Ouma', '20120931'],
  ['Faith Chebet Koech', '20150417'],
  ['Brian Mutua Musyoka', '20160552'],
  ['Agnes Nyambura Mwangi', '20110673'],
  ['Collins Wafula Simiyu', '20170734'],
  ['Purity Kawira Mugambi', '20130815'],
  ['Hassan Abdi Mohamed', '20180996'],
  ['Lucy Akinyi Odhiambo', '20141027'],
  ['Kennedy Kiplagat Langat', '20121138'],
  ['Mary Wairimu Ndungu', '20151249'],
  ['Samuel Kimani Gitau', '20161350'],
  ['Janet Moraa Nyaboke', '20171461'],
  ['Peter Ochieng Okoth', '20111572'],
  ['Rose Mumbua Kioko', '20191683'],
  ['Victor Kibet Cheruiyot', '20131794'],
  ['Grace Naliaka Barasa', '20141805'],
] as const;

/** Clears decisions and seeds the ladders with "now" at `seededAt` (tests pass a fixed time). */
export function resetActionsMock(seededAt: number = Date.now()) {
  ladders.clear();
  replies.clear();
  letters.clear();
  attachments.clear();
  sequence = 400;
  clock = { seeded: seededAt, real: Date.now() };
  const base = seededAt;
  const ids = MOCK_LADDER_IDS;

  // A notice drafted yesterday for an initial declaration overdue since 6 days ago.
  store(
    ladderOf(
      {
        id: ids.noticeProposed,
        subjectKind: 'obligation',
        subjectReference: 'initial:2026-09-07',
        declarantName: 'Nancy Wairimu Muriuki',
        personnelFileNumber: '20260318',
        startedDaysAgo: 1,
      },
      [blank(actionId(1, 1), ids.noticeProposed, 'notice-to-comply', base - DAY)],
      base,
    ),
  );

  const respondedNotice = issued(
    actionId(2, 1),
    ids.noticeResponded,
    'notice-to-comply',
    13,
    12,
    MERCY,
    base,
  );
  attachments.set('a77a0000-0000-4000-8000-000000000101', 'Reply to clarification.pdf');
  attachments.set(
    'a77a0000-0000-4000-8000-000000000102',
    'Equity Bank statements Jan-Jun 2026.pdf',
  );
  store(
    ladderOf(
      {
        id: ids.noticeResponded,
        subjectKind: 'clarification',
        subjectReference: 'CLR-TSC-2026-0000318-5',
        declarantName: 'Paul Kipchumba Sang',
        personnelFileNumber: '20104410',
        startedDaysAgo: 13,
      },
      [
        {
          ...respondedNotice,
          status: 'responded',
          response: {
            text: 'I replied to the clarification by email on 28 August but I now understand it had to be through the portal. I have attached my reply and the bank statements it refers to. I will also submit the response in the portal this week.',
            attachments: [
              {
                uploadId: 'a77a0000-0000-4000-8000-000000000101',
                fileName: 'Reply to clarification.pdf',
              },
              {
                uploadId: 'a77a0000-0000-4000-8000-000000000102',
                fileName: 'Equity Bank statements Jan-Jun 2026.pdf',
              },
            ],
            submittedAt: iso(base - 7 * DAY),
          },
        },
      ],
      base,
    ),
    [KEVIN.subject],
  );

  store(
    ladderOf(
      {
        id: ids.warningBlocked,
        subjectKind: 'clarification',
        subjectReference: 'CLR-TSC-2026-0000297-K',
        declarantName: 'Lydia Moraa Nyakundi',
        personnelFileNumber: '20133021',
        startedDaysAgo: 20,
      },
      [
        issued(actionId(3, 1), ids.warningBlocked, 'notice-to-comply', 20, 18, KEVIN, base),
        blank(actionId(3, 2), ids.warningBlocked, 'warning', base - 4 * DAY),
      ],
      base,
    ),
    [CALLER, PETER.subject],
  );

  store(
    ladderOf(
      {
        id: ids.warningIssued,
        subjectKind: 'obligation',
        subjectReference: 'biennial:2026',
        declarantName: 'Moses Wekesa Barasa',
        personnelFileNumber: '20091187',
        startedDaysAgo: 34,
      },
      [
        issued(actionId(4, 1), ids.warningIssued, 'notice-to-comply', 34, 33, MERCY, base),
        issued(actionId(4, 2), ids.warningIssued, 'warning', 19, 5, PETER, base),
      ],
      base,
    ),
  );

  store(
    ladderOf(
      {
        id: ids.stoppageProposed,
        subjectKind: 'obligation',
        subjectReference: 'biennial:2026',
        declarantName: 'Janet Achieng Odero',
        personnelFileNumber: '20085562',
        startedDaysAgo: 45,
      },
      [
        issued(actionId(5, 1), ids.stoppageProposed, 'notice-to-comply', 45, 44, MERCY, base),
        issued(actionId(5, 2), ids.stoppageProposed, 'warning', 30, 29, PETER, base),
        blank(actionId(5, 3), ids.stoppageProposed, 'salary-stoppage', base - 2 * DAY),
      ],
      base,
    ),
  );

  // The stoppage approved yesterday; payroll has not acknowledged the instruction.
  const pendingStoppage = issued(
    actionId(9, 3),
    ids.payrollPending,
    'salary-stoppage',
    3,
    1,
    SAMUEL,
    base,
  );
  store(
    ladderOf(
      {
        id: ids.payrollPending,
        subjectKind: 'obligation',
        subjectReference: 'biennial:2026',
        declarantName: 'Hellen Atieno Ochieng',
        personnelFileNumber: '20090554',
        startedDaysAgo: 34,
      },
      [
        issued(actionId(9, 1), ids.payrollPending, 'notice-to-comply', 34, 33, MERCY, base),
        issued(actionId(9, 2), ids.payrollPending, 'warning', 19, 18, PETER, base),
        {
          ...pendingStoppage,
          status: 'approved-pending-payroll',
          issuedAt: null,
          windowEndsAt: null,
          letter: null,
        },
      ],
      base,
    ),
  );

  // The salary stopped 33 days ago and its window over: the disciplinary referral drafted.
  store(
    ladderOf(
      {
        id: ids.disciplinaryProposed,
        subjectKind: 'clarification',
        subjectReference: 'CLR-TSC-2026-0000519-L',
        declarantName: 'Stephen Kiprotich Kosgei',
        personnelFileNumber: '19987702',
        startedDaysAgo: 66,
      },
      [
        issued(actionId(10, 1), ids.disciplinaryProposed, 'notice-to-comply', 66, 65, MERCY, base),
        issued(actionId(10, 2), ids.disciplinaryProposed, 'warning', 50, 49, KEVIN, base),
        stopped(
          issued(
            actionId(10, 3),
            ids.disciplinaryProposed,
            'salary-stoppage',
            35,
            33,
            SAMUEL,
            base,
          ),
          'PAY-ACK-2026-0091822',
        ),
        blank(actionId(10, 4), ids.disciplinaryProposed, 'disciplinary-referral', base - 3 * DAY),
      ],
      base,
    ),
    [PETER.subject],
  );

  // Filed while the salary was stopped: payroll acknowledged the reinstatement.
  const reinstatedStoppage = stopped(
    issued(actionId(11, 3), ids.reinstated, 'salary-stoppage', 24, 22, SAMUEL, base),
    'PAY-ACK-2026-0090417',
  );
  const reinstatedLadder = ladderOf(
    {
      id: ids.reinstated,
      subjectKind: 'obligation',
      subjectReference: 'biennial:2026',
      declarantName: 'Grace Wanjiru Kariuki',
      personnelFileNumber: '20030011',
      startedDaysAgo: 55,
    },
    [
      {
        ...issued(actionId(11, 1), ids.reinstated, 'notice-to-comply', 55, 54, MERCY, base),
        status: 'complied',
      },
      {
        ...issued(actionId(11, 2), ids.reinstated, 'warning', 40, 39, PETER, base),
        status: 'complied',
      },
      {
        ...reinstatedStoppage,
        status: 'reinstated',
        payrollResume: acknowledged(
          `${reinstatedStoppage.reference ?? ''}-R`,
          'resume_salary',
          'PAY-ACK-2026-0093310',
          base - 5 * DAY + 2 * 3_600_000,
        ),
      },
    ],
    base,
  );
  store({
    ...reinstatedLadder,
    status: 'complied',
    closingCause: 'filed',
    endedAt: iso(base - 5 * DAY),
  });

  const declinedLadder = ladderOf(
    {
      id: ids.declined,
      subjectKind: 'obligation',
      subjectReference: 'biennial:2026',
      declarantName: 'Abdullahi Hussein Ali',
      personnelFileNumber: '20170921',
      startedDaysAgo: 27,
    },
    [
      {
        ...blank(actionId(6, 1), ids.declined, 'notice-to-comply', base - 27 * DAY),
        status: 'declined',
        declinedBy: PETER,
        declinedAt: iso(base - 20 * DAY),
        declineNote:
          'The declarant is on approved study leave abroad until December. HR has asked the reporting officer to correct the obligation date on the roster.',
      },
    ],
    base,
  );
  store({ ...declinedLadder, status: 'declined', endedAt: iso(base - 20 * DAY) });

  const compliedNotice = issued(
    actionId(7, 1),
    ids.complied,
    'notice-to-comply',
    16,
    15,
    MERCY,
    base,
  );
  const compliedLadder = ladderOf(
    {
      id: ids.complied,
      subjectKind: 'obligation',
      subjectReference: 'biennial:2026',
      declarantName: 'Winnie Chebet Langat',
      personnelFileNumber: '20112264',
      startedDaysAgo: 16,
    },
    [{ ...compliedNotice, status: 'complied' }],
    base,
  );
  store({
    ...compliedLadder,
    status: 'complied',
    closingCause: 'filed',
    endedAt: iso(base - 10 * DAY),
  });

  const endedNotice = issued(actionId(8, 1), ids.ended, 'notice-to-comply', 25, 24, KEVIN, base);
  const endedLadder = ladderOf(
    {
      id: ids.ended,
      subjectKind: 'clarification',
      subjectReference: 'CLR-TSC-2026-0000251-T',
      declarantName: 'Stephen Mwangi Karanja',
      personnelFileNumber: '20077735',
      startedDaysAgo: 25,
    },
    [{ ...endedNotice, status: 'cancelled' }],
    base,
  );
  store({
    ...endedLadder,
    status: 'ended',
    closingCause: 'clarification-withdrawn',
    endedAt: iso(base - 18 * DAY),
  });

  FILLER_NAMES.forEach(([name, file], index) => {
    const n = 100 + index;
    const id = `1add0000-0000-4000-8000-${hex(n, 12)}`;
    const startedDaysAgo = 40 + index * 3;
    const notice = issued(
      actionId(n, 1),
      id,
      'notice-to-comply',
      startedDaysAgo,
      startedDaysAgo - 1,
      MERCY,
      base,
    );
    const steps =
      index % 3 === 0
        ? [
            notice,
            blank(
              actionId(n, 2),
              id,
              'warning',
              base - (FILLER_DRAFTED_DAYS[index / 3] ?? 1) * DAY,
            ),
          ]
        : index % 3 === 1
          ? [
              notice,
              issued(
                actionId(n, 2),
                id,
                'warning',
                startedDaysAgo - 15,
                Math.min(13, index),
                PETER,
                base,
              ),
            ]
          : [{ ...notice, status: 'complied' as const }];
    const ladder = ladderOf(
      {
        id,
        subjectKind: 'obligation',
        subjectReference: 'biennial:2026',
        declarantName: name,
        personnelFileNumber: file,
        startedDaysAgo,
      },
      steps,
      base,
    );
    store(
      index % 3 === 2
        ? { ...ladder, status: 'complied', closingCause: 'filed', endedAt: iso(base - index * DAY) }
        : ladder,
    );
  });
}

function ensureSeeded() {
  if (ladders.size === 0) resetActionsMock();
}

/** A ladder as the mock holds it (tests). */
export function mockLadder(id: string): Ladder | undefined {
  ensureSeeded();
  return ladders.get(id)?.ladder;
}

/** What the placeholder file route names: a step letter or a response document. */
export function mockActionFileTitle(id: string): string | null {
  ensureSeeded();
  return letters.get(id) ?? attachments.get(id) ?? null;
}

function currentAction(ladder: Ladder): Action | undefined {
  return ladder.steps.at(-1);
}

function encodeCursor(index: number): string {
  return Buffer.from(JSON.stringify({ i: index })).toString('base64url');
}

function decodeCursor(cursor: string): number | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return isRecord(value) && typeof value.i === 'number' ? value.i : null;
  } catch {
    return null;
  }
}

function isReviewStaff(caller: MockCaller): boolean {
  return caller.roles.includes(REVIEWER) || caller.roles.includes(SUPERVISOR);
}

function list(url: URL, caller: MockCaller, slug: string): Response {
  if (slug !== TENANT || !isReviewStaff(caller)) return problem(404, 'Not found');
  const status = url.searchParams.get('status');
  const step = url.searchParams.get('step');
  const limit = Number(url.searchParams.get('limit') ?? '50');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return problem(400, 'Invalid limit');
  const cursor = url.searchParams.get('cursor');
  const start = cursor === null ? 0 : decodeCursor(cursor);
  if (start === null) return problem(400, 'Unknown cursor');
  const matching = [...ladders.values()]
    .map((each) => each.ladder)
    .filter((ladder) => {
      const current = currentAction(ladder);
      return (
        (status === null || current?.status === status) && (step === null || current?.step === step)
      );
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  const items = matching.slice(start, start + limit);
  const more = start + limit < matching.length;
  return json(200, { items, nextCursor: more ? encodeCursor(start + limit) : null });
}

function find(actionIdValue: string): { stored: StoredLadder; action: Action } | null {
  for (const stored of ladders.values()) {
    const action = stored.ladder.steps.find((each) => each.id === actionIdValue);
    if (action) return { stored, action };
  }
  return null;
}

function forbidden(
  type: 'separation-of-duties' | 'supervisor-required',
  reason: string,
  detail: string,
) {
  return json(403, { type, title: 'Forbidden', status: 403, detail, code: type, reason });
}

type CannotApprove = 'proposer' | 'reviewer-of-record' | 'role';

/** Why the separation-of-duties rule keeps `caller` from deciding `action`, or null. */
function cannotApprove(
  caller: MockCaller,
  stored: StoredLadder,
  action: Action,
): CannotApprove | null {
  if (action.proposer?.subject === caller.subject) return 'proposer';
  const record = stored.reviewersOfRecord.map((each) => (each === CALLER ? caller.subject : each));
  if (record.includes(caller.subject)) return 'reviewer-of-record';
  const admitted = isGraveStep(action.step)
    ? caller.roles.includes(SUPERVISOR)
    : isReviewStaff(caller);
  return admitted ? null : 'role';
}

/**
 * The action approval source of the inbox mock (review's `ActionApprovals`): drafted steps of
 * active ladders, with the steps issued before each and the declarant's responses.
 */
export const actionApprovals: MockApprovalSource<'action'> = {
  kind: 'action',
  pending: (caller) => {
    ensureSeeded();
    const asCaller: MockCaller = {
      subject: caller.subject,
      name: caller.name,
      roles: [...caller.roles],
    };
    return [...ladders.values()].flatMap((stored) => {
      const { ladder } = stored;
      if (ladder.status !== 'active') return [];
      return ladder.steps
        .filter((action) => action.status === 'proposed')
        .map((action) => ({
          subjectId: action.id,
          proposedAt: action.proposedAt,
          proposerKind: action.proposerKind,
          proposer: action.proposer,
          summary: {
            ladderId: ladder.id,
            step: action.step,
            subjectKind: ladder.subjectKind,
            subjectId: ladder.subjectId,
            subjectReference: ladder.subjectReference,
            declarantName: ladder.declarantName,
            personnelFileNumber: ladder.personnelFileNumber,
            priorSteps: ladder.steps
              .filter((prior) => prior.id !== action.id && prior.reference !== null)
              .map((prior) => ({
                actionId: prior.id,
                step: prior.step,
                status: prior.status,
                reference: prior.reference,
                issuedAt: prior.issuedAt,
                respondedAt: prior.response?.submittedAt ?? null,
                responseExcerpt: prior.response?.text.slice(0, 200) ?? null,
                responseAttachments: prior.response?.attachments.length ?? 0,
              })),
          },
          cannotApproveReason: cannotApprove(asCaller, stored, action),
        }));
    });
  },
  find: (subjectId) => {
    const found = find(subjectId);
    return found
      ? { pending: found.action.status === 'proposed', status: found.action.status }
      : null;
  },
};

/** The separation-of-duties rule as the service applies it, or null when the caller may decide. */
function refusal(caller: MockCaller, stored: StoredLadder, action: Action): Response | null {
  const reason = cannotApprove(caller, stored, action);
  if (reason === 'proposer') {
    return forbidden(
      'separation-of-duties',
      reason,
      'You proposed this, so another supervisor must decide it.',
    );
  }
  if (reason === 'reviewer-of-record') {
    return forbidden(
      'separation-of-duties',
      reason,
      'You reviewed this case, so another supervisor must decide it.',
    );
  }
  if (reason === 'role') {
    return forbidden(
      'supervisor-required',
      reason,
      'Only a supervisor can approve or return this.',
    );
  }
  return null;
}

function officerOf(caller: MockCaller): Assignee {
  return { subject: caller.subject ?? 'unknown', name: caller.name ?? 'You' };
}

function replace(stored: StoredLadder, action: Action, ladder: Partial<Ladder> = {}) {
  stored.ladder = {
    ...stored.ladder,
    ...ladder,
    steps: stored.ladder.steps.map((each) => (each.id === action.id ? action : each)),
  };
}

async function remembered(key: string | null, answer: () => Promise<Response> | Response) {
  if (key) {
    const replay = replies.get(key);
    if (replay) return replay.clone();
  }
  const response = await answer();
  if (key && response.ok) replies.set(key, response.clone());
  return response;
}

function approve(caller: MockCaller, id: string): Response {
  const found = find(id);
  if (!found || !isReviewStaff(caller)) return problem(404, 'Not found');
  const { stored, action } = found;
  const refused = refusal(caller, stored, action);
  if (refused) return refused;
  if (action.status !== 'proposed')
    return problem(409, 'This step is not waiting for a decision', 'not-proposed');
  const at = now();
  const reference = nextReference();
  const window = LADDER_WINDOW_DAYS[action.step];
  const approved: Action = {
    ...action,
    status: 'issued',
    approver: officerOf(caller),
    approvedAt: iso(at),
    issuedAt: iso(at),
    windowEndsAt: window === null ? null : iso(at + window * DAY),
    reference,
    letter: letterOf(action.id, reference, action.step),
  };
  // The mock's payroll acknowledges a stop-salary instruction at once (the service sends it
  // first and issues the letter once payroll acknowledges).
  if (action.step === 'salary-stoppage') {
    sequence += 1;
    approved.payrollStop = acknowledged(
      reference,
      'stop_salary',
      `PAY-ACK-${String(new Date(at).getUTCFullYear())}-${String(sequence).padStart(7, '0')}`,
      at,
    );
  }
  replace(stored, approved);
  // The service answers the approval itself; the workflow issues the letter a moment later.
  return json(200, {
    ...approved,
    status: 'approved',
    issuedAt: null,
    windowEndsAt: null,
    letter: null,
  });
}

async function decline(request: Request, caller: MockCaller, id: string): Promise<Response> {
  const found = find(id);
  if (!found || !isReviewStaff(caller)) return problem(404, 'Not found');
  const body = await readJson(request);
  const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 2000)
    return problem(400, 'A note of 1 to 2,000 characters is required');
  const { stored, action } = found;
  const refused = refusal(caller, stored, action);
  if (refused) return refused;
  if (action.status !== 'proposed')
    return problem(409, 'This step is not waiting for a decision', 'not-proposed');
  const at = iso(now());
  const declined: Action = {
    ...action,
    status: 'declined',
    declinedBy: officerOf(caller),
    declinedAt: at,
    declineNote: reason,
  };
  replace(
    stored,
    declined,
    action.step === 'disciplinary-referral' ? {} : { status: 'declined', endedAt: at },
  );
  return json(200, declined);
}

function restart(caller: MockCaller, id: string): Response {
  const stored = ladders.get(id);
  if (!stored || !isReviewStaff(caller)) return problem(404, 'Not found');
  if (!caller.roles.includes(SUPERVISOR)) {
    return forbidden('supervisor-required', 'role', 'Only a supervisor can restart a ladder.');
  }
  if (stored.ladder.status !== 'declined') {
    return problem(409, 'Only a declined ladder can be restarted', 'ladder-not-declined');
  }
  const declined = stored.ladder.steps.findLast((each) => each.status === 'declined');
  const step = declined?.step ?? 'notice-to-comply';
  const n = stored.ladder.steps.length + 1;
  const drafted = blank(
    `${stored.ladder.steps[0]?.id.slice(0, -4) ?? 'ac710000-0000-4000-8000-00000000'}${hex(n, 4)}`,
    id,
    step,
    now(),
  );
  stored.ladder = {
    ...stored.ladder,
    status: 'active',
    endedAt: null,
    closingCause: null,
    currentStep: step,
    steps: [...stored.ladder.steps, drafted],
  };
  return json(200, stored.ladder);
}

/**
 * Answers the ladder endpoints, or null for any other request (the review mock routes on).
 */
export async function actionsRoute(request: Request, caller: MockCaller): Promise<Response | null> {
  ensureSeeded();
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const key = request.headers.get('Idempotency-Key');

  const listed = /^\/v1\/commissions\/([^/]+)\/actions$/.exec(pathname);
  if (method === 'GET' && listed?.[1]) return list(url, caller, listed[1]);

  const one = /^\/v1\/review\/ladders\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && one?.[1]) {
    const stored = ladders.get(one[1]);
    return stored && isReviewStaff(caller) ? json(200, stored.ladder) : problem(404, 'Not found');
  }

  const restarted = /^\/v1\/review\/ladders\/([^/]+)\/restart$/.exec(pathname);
  if (method === 'POST' && restarted?.[1]) {
    const ladderId = restarted[1];
    return remembered(key, () => restart(caller, ladderId));
  }

  const approved = /^\/v1\/review\/actions\/([^/]+)\/approve$/.exec(pathname);
  if (method === 'POST' && approved?.[1]) {
    if (!key) return problem(400, 'Idempotency-Key is required');
    const id = approved[1];
    return remembered(key, () => approve(caller, id));
  }

  const declined = /^\/v1\/review\/actions\/([^/]+)\/decline$/.exec(pathname);
  if (method === 'POST' && declined?.[1]) {
    const id = declined[1];
    return remembered(key, () => decline(request, caller, id));
  }

  return null;
}

/**
 * The documents service's staff download of a step letter (`GET /v1/documents/{id}/download`),
 * for the console's documents client under REVIEW_MOCK.
 */
export function mockActionDocumentsFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const { pathname } = new URL(request.url);
  const download = /^\/v1\/documents\/([^/]+)\/download$/.exec(pathname);
  if (request.method === 'GET' && download?.[1] && letters.has(download[1])) {
    return Promise.resolve(
      json(200, {
        downloadUrl: `/api/mock-files/${download[1]}`,
        expiresAt: iso(Date.now() + 5 * 60_000),
        sha256: 'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78',
      }),
    );
  }
  return Promise.resolve(problem(404, 'Not found'));
}
