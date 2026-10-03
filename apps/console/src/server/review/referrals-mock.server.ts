/**
 * The review mock's referrals to EACC (spec 08, review.yaml), behind `mock.server.ts`, which owns
 * the cases and hands them in through `ReferralCases`. As the service has it (services/review,
 * PR #444):
 *
 * - Propose from a case (its assignee only, else 403 `not-the-assignee`): grounds undeclared or
 *   unexplained assets, a narrative (1 to 8,000), 1 to 100 registry or comparison flags of the
 *   case and up to 50 of its issued clarifications (a draft, a flag of another rule or another
 *   case is a 400); 409 `referral-open` while one from the case waits. Idempotency-Key replays
 *   the first answer.
 * - The Commission's referrals, newest proposal first, by status, cursor paging; one referral
 *   with `evidence`: what its package includes, by reference.
 * - Approve (Idempotency-Key required) and decline (a note, 1 to 2,000) by the separation-of-
 *   duties rule: 403 `separation-of-duties` (with `reason`) for the proposer or a reviewer of
 *   record of its case, 403 `supervisor-required` for anyone else without the supervisor role;
 *   409 `not-proposed` once decided. Approval allocates the RFL reference; the package (a
 *   manifest with a SHA-256 per item) is assembled and the referral sent
 *   `MOCK_PACKAGE_DELAY_MS` later, as the service's workflow does in the background.
 * - The approvals inbox lists the proposed ones through `referralApprovals`
 *   (`approvals-mock.server.ts`), with their summary as the service's `ReferralApprovals` has it.
 *
 * Seeded (`MOCK_REFERRAL_IDS`): two system proposals (two missed cycles, an unanswered
 * clarification), assets referrals proposed by Peter Mwangi, by Mercy Wambui on a case the
 * caller reviewed and by the caller, one sent with its manifest, one declined with a note.
 */
import { createHash, randomUUID } from 'node:crypto';

import { SUPERVISOR } from '@adili/roles';

import { ASSET_RULES } from '../../referral/view';
import { isRecord, json, problem, readJson } from '../mock-http';
import type { MockApprovalSource } from './approvals-mock.server';
import type { Assignee, CaseListItem, Clarification, Flag, Referral } from './types';

/** What the referrals mock reads of a case, resolved for the caller. */
export interface ReferralCase {
  item: CaseListItem;
  holder: Assignee | null;
  /** Everyone who held the case: its reviewers of record. */
  history: Assignee[];
  flags: Flag[];
  clarifications: Clarification[];
}

export interface ReferralCases {
  find: (caseId: string) => ReferralCase | null;
}

/** The caller, as the mock reads them from the token. */
export interface ReferralCaller extends Assignee {
  roles: readonly string[];
}

export const MOCK_REFERRAL_IDS = {
  /** System: two biennial cycles unfiled past the ladder; no case. */
  twoMissedCycles: 'fe1e0000-0000-4000-8000-000000000001',
  /** System: a clarification of Mercy Wambui's case unanswered past the stoppage window. */
  unanswered: 'fe1e0000-0000-4000-8000-000000000002',
  /** Proposed by Peter Mwangi from his case: anyone else's supervisor may approve it. */
  fromPeter: 'fe1e0000-0000-4000-8000-000000000003',
  /** Proposed by Mercy Wambui from a case the caller held before: a reviewer of record. */
  ofRecord: 'fe1e0000-0000-4000-8000-000000000004',
  /** Proposed by the caller. */
  byCaller: 'fe1e0000-0000-4000-8000-000000000005',
  /** Approved by Lucy Wambui and sent, with its manifest. */
  sent: 'fe1e0000-0000-4000-8000-000000000006',
  /** A system proposal Lucy Wambui declined with a note. */
  declined: 'fe1e0000-0000-4000-8000-000000000007',
} as const;

/** How long after approval the package is assembled and the referral sent. */
export const MOCK_PACKAGE_DELAY_MS = 6_000;

/** Stands for "whoever is signed in" as a seeded proposer (the case mock's `MOCK_CALLER`). */
const CALLER_SUBJECT = '(caller)';

type Evidence = NonNullable<Referral['evidence']>[number];
type ManifestItem = NonNullable<Referral['package']>['manifest'][number];

interface StoredReferral extends Omit<Referral, 'evidence'> {
  evidence: Evidence[];
  /** The package's document once assembled (and its manifest), set at approval. */
  packageDocumentId: string | null;
}

const referrals = new Map<string, StoredReferral>();
/** Answers already given to a proposal, by Idempotency-Key. */
const replays = new Map<string, { status: number; body: unknown }>();
let issuer = 'TSC';
let sequence = 0;

const DAY_MS = 86_400_000;

function resolved(who: Assignee | null, caller: Assignee): Assignee | null {
  return who?.subject === CALLER_SUBJECT ? { subject: caller.subject, name: caller.name } : who;
}

/** RFL-<ISSUER>-<YEAR>-<seq>-<check> (ADR-011), the check a stand-in letter. */
function rflReference(at: string): string {
  sequence += 1;
  const year = new Date(at).getUTCFullYear();
  return `RFL-${issuer}-${String(year)}-${String(sequence).padStart(7, '0')}-${'B9KMPRTX'[sequence % 8] ?? 'B'}`;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The manifest the package lists: each item of `evidence` with its hash; letters are files. */
function manifestOf(evidence: Evidence[]): ManifestItem[] {
  return evidence.map((each) => ({
    kind: each.kind,
    reference: each.reference,
    sha256: sha256(`${each.kind}:${each.reference}`),
    documentId: each.kind === 'letter' ? randomUUID() : null,
  }));
}

/** What a referral from a case includes: its declaration, the flags, clarifications, letters. */
function caseEvidence(found: ReferralCase, flagIds: string[], clarificationIds: string[]) {
  const reference = found.item.reference;
  const flags = found.flags.filter((flag) => flagIds.includes(flag.id));
  const clarifications = found.clarifications.filter((each) => clarificationIds.includes(each.id));
  const evidence: Evidence[] = [
    {
      kind: 'declaration-version',
      reference: `${reference} v${String(found.item.currentVersion)}`,
    },
    ...flags.map((flag): Evidence => ({ kind: 'flag', reference: `${reference} ${flag.ruleId}` })),
    ...clarifications.map((each): Evidence => ({
      kind: 'clarification',
      reference: each.reference ?? each.id,
    })),
    ...clarifications.flatMap((each): Evidence[] =>
      each.letter && each.reference ? [{ kind: 'letter', reference: each.reference }] : [],
    ),
  ];
  return evidence;
}

const EMPTY_SOURCES: Referral['sources'] = {
  caseIds: [],
  flagIds: [],
  clarificationIds: [],
  obligationIds: [],
  actionIds: [],
};

function stored(
  fields: Pick<
    Referral,
    | 'id'
    | 'caseId'
    | 'cycleYear'
    | 'grounds'
    | 'proposerKind'
    | 'proposer'
    | 'proposedAt'
    | 'narrative'
    | 'declarantName'
    | 'personnelFileNumber'
  > & { sources?: Partial<Referral['sources']>; evidence: Evidence[] },
): StoredReferral {
  return {
    ...fields,
    sources: { ...EMPTY_SOURCES, ...fields.sources },
    status: 'proposed',
    approver: null,
    approvedAt: null,
    declinedBy: null,
    declinedAt: null,
    declineNote: null,
    reference: null,
    package: null,
    sentAt: null,
    icmsCaseNumber: null,
    icmsRegisteredAt: null,
    packageDocumentId: null,
  };
}

const CALLER: Assignee = { subject: CALLER_SUBJECT, name: CALLER_SUBJECT };

/** The cases the seeded referrals come from (`MOCK_CASE_IDS` of the case mock). */
export interface ReferralSeedCases {
  peters: string;
  awaitingOld: string;
  awaitingOfRecord: string;
  awaitingFurther: string;
  returned: string;
}

/** Empties the store and seeds `MOCK_REFERRAL_IDS`, dated relative to `now`. */
export function resetReferralsMock(
  now: number,
  seedCases: ReferralSeedCases,
  cases: ReferralCases,
  options: {
    issuer: string;
    /** Who proposes and decides the seeded referrals (`MOCK_OFFICERS` of the case mock). */
    officers: { peter: Assignee; mercy: Assignee; lucy: Assignee };
  },
) {
  const { peter: PETER, mercy: MERCY, lucy: LUCY } = options.officers;
  referrals.clear();
  replays.clear();
  issuer = options.issuer;
  sequence = 30;
  const at = (days: number) => new Date(now - days * DAY_MS).toISOString();
  const R = MOCK_REFERRAL_IDS;
  const year = new Date(now).getUTCFullYear();

  const fromCase = (
    id: string,
    caseId: string,
    proposer: Assignee,
    days: number,
    grounds: 'undeclared-assets' | 'unexplained-assets',
    narrative: string,
  ): StoredReferral | null => {
    const found = cases.find(caseId);
    if (!found) return null;
    const flagIds = found.flags
      .filter((flag) => ASSET_RULES.has(flag.ruleId))
      .slice(0, 2)
      .map((flag) => flag.id);
    const clarificationIds = found.clarifications
      .filter((each) => each.status !== 'draft' && each.status !== 'withdrawn')
      .slice(0, 1)
      .map((each) => each.id);
    return stored({
      id,
      caseId,
      cycleYear: found.item.cycleYear,
      grounds,
      proposerKind: 'user',
      proposer,
      proposedAt: at(days),
      narrative,
      declarantName: found.item.declarantName,
      personnelFileNumber: found.item.personnelFileNumber,
      sources: { caseIds: [caseId], flagIds, clarificationIds },
      evidence: caseEvidence(found, flagIds, clarificationIds),
    });
  };

  const seeds: (StoredReferral | null)[] = [
    stored({
      id: R.twoMissedCycles,
      caseId: null,
      cycleYear: year,
      grounds: 'two-missed-cycles',
      proposerKind: 'system',
      proposer: null,
      proposedAt: at(2),
      narrative: `Biennial declarations for ${String(year - 2)} and ${String(year)} not submitted; the ${String(year)} ladder has reached salary stoppage.`,
      declarantName: 'Stephen Mwangi Karanja',
      personnelFileNumber: '19987702',
      sources: {
        obligationIds: [randomUUID(), randomUUID()],
        actionIds: [randomUUID(), randomUUID(), randomUUID()],
      },
      evidence: [
        { kind: 'obligation', reference: `biennial:${String(year - 2)}` },
        { kind: 'obligation', reference: `biennial:${String(year)}` },
        { kind: 'letter', reference: `ADM-${issuer}-${String(year)}-0000301-8` },
        { kind: 'letter', reference: `ADM-${issuer}-${String(year)}-0000309-R` },
        { kind: 'letter', reference: `ADM-${issuer}-${String(year)}-0000371-H` },
      ],
    }),
    (() => {
      const found = cases.find(seedCases.awaitingOld);
      if (!found) return null;
      const overdue = found.clarifications.find((each) => each.status === 'overdue');
      const clr = overdue?.reference ?? `CLR-${issuer}-${String(year)}-0000187-S`;
      return stored({
        id: R.unanswered,
        caseId: seedCases.awaitingOld,
        cycleYear: found.item.cycleYear,
        grounds: 'unanswered-clarification',
        proposerKind: 'system',
        proposer: null,
        proposedAt: at(24),
        narrative: `${clr} unanswered; the ladder reached the end of the salary stoppage window.`,
        declarantName: found.item.declarantName,
        personnelFileNumber: found.item.personnelFileNumber,
        sources: {
          caseIds: [seedCases.awaitingOld],
          clarificationIds: overdue ? [overdue.id] : [],
          actionIds: [randomUUID(), randomUUID()],
        },
        evidence: [
          {
            kind: 'declaration-version',
            reference: `${found.item.reference} v${String(found.item.currentVersion)}`,
          },
          { kind: 'clarification', reference: clr },
          { kind: 'letter', reference: clr },
          { kind: 'letter', reference: `ADM-${issuer}-${String(year)}-0000212-A` },
          { kind: 'letter', reference: `ADM-${issuer}-${String(year)}-0000228-T` },
        ],
      });
    })(),
    fromCase(
      R.fromPeter,
      seedCases.peters,
      PETER,
      5,
      'undeclared-assets',
      'The plot is valued 150% higher than in the 2024 declaration with no acquisition or improvement recorded, and the money market fund units appear without an acquisition mark. The clarification response did not explain either. Referral under regulation 20(1)(c) for undeclared assets.',
    ),
    fromCase(
      R.ofRecord,
      seedCases.awaitingOfRecord,
      MERCY,
      9,
      'unexplained-assets',
      'Net assets nearly tripled between the 2024 and 2026 statements while declared income rose 6%. The response attributes the increase to farming income that does not appear in the declared income or the KRA record.',
    ),
    fromCase(
      R.byCaller,
      seedCases.returned,
      CALLER,
      1,
      'undeclared-assets',
      'Ardhisasa lists a parcel registered to the declarant in 2024 that the declaration leaves out.',
    ),
    (() => {
      const sent = fromCase(
        R.sent,
        seedCases.awaitingFurther,
        PETER,
        14,
        'undeclared-assets',
        'The Business Registration Service lists the declarant as a director of a company since 2022, which the declaration leaves out; the response did not explain it.',
      );
      if (!sent) return null;
      const approvedAt = at(12);
      sent.status = 'sent';
      sent.approver = LUCY;
      sent.approvedAt = approvedAt;
      sent.reference = rflReference(approvedAt);
      sent.packageDocumentId = randomUUID();
      sent.package = {
        documentId: sent.packageDocumentId,
        verificationId: `VRF-${sent.packageDocumentId.slice(0, 10).toUpperCase()}`,
        manifest: manifestOf(sent.evidence),
      };
      sent.sentAt = new Date(Date.parse(approvedAt) + 60_000).toISOString();
      return sent;
    })(),
    (() => {
      const declined = stored({
        id: R.declined,
        caseId: null,
        cycleYear: year,
        grounds: 'two-missed-cycles',
        proposerKind: 'system',
        proposer: null,
        proposedAt: at(28),
        narrative: `Biennial declarations for ${String(year - 2)} and ${String(year)} not submitted.`,
        declarantName: 'Joyce Wangari Mbugua',
        personnelFileNumber: '19950310',
        sources: { obligationIds: [randomUUID(), randomUUID()] },
        evidence: [
          { kind: 'obligation', reference: `biennial:${String(year - 2)}` },
          { kind: 'obligation', reference: `biennial:${String(year)}` },
        ],
      });
      declined.status = 'declined';
      declined.declinedBy = LUCY;
      declined.declinedAt = at(26);
      declined.declineNote =
        'The declarant died on 3 Jun. The reporting officer is updating the roster.';
      return declined;
    })(),
  ];
  for (const seed of seeds) if (seed) referrals.set(seed.id, seed);
}

/** The referral as read now: sent, with its package, once the package has been assembled. */
function current(found: StoredReferral): StoredReferral {
  if (found.status !== 'approved' || !found.approvedAt) return found;
  const sentAt = Date.parse(found.approvedAt) + MOCK_PACKAGE_DELAY_MS;
  if (Date.now() < sentAt) return found;
  const documentId = randomUUID();
  found.status = 'sent';
  found.sentAt = new Date(sentAt).toISOString();
  found.packageDocumentId = documentId;
  found.package = {
    documentId,
    verificationId: `VRF-${documentId.slice(0, 10).toUpperCase()}`,
    manifest: manifestOf(found.evidence),
  };
  return found;
}

function view(found: StoredReferral, caller: Assignee, withEvidence: boolean): Referral {
  const referral: Referral & { packageDocumentId?: string | null } = {
    ...current(found),
    proposer: resolved(found.proposer, caller),
  };
  // Where the mock keeps the package's document; the contract has it under `package`.
  delete referral.packageDocumentId;
  if (!withEvidence) delete referral.evidence;
  return referral;
}

/** The evidence package a document id is, for the placeholder file route. */
export function mockReferralPackageTitle(documentId: string): string | null {
  for (const each of referrals.values()) {
    if (each.packageDocumentId === documentId) {
      return `Referral evidence package ${each.reference ?? ''}`;
    }
  }
  return null;
}

/** How much of the narrative the inbox card shows (services/review `NARRATIVE_EXCERPT`). */
const NARRATIVE_EXCERPT = 200;

/**
 * The approvals inbox's referral source (`approvals-mock.server.ts`): the proposed referrals
 * with their summary as the service's `ReferralApprovals` gives it, and who may not approve
 * each by the separation-of-duties rule. `casesFor` reads the cases for the caller.
 */
export function referralApprovals(
  casesFor: (caller: Assignee) => ReferralCases,
): MockApprovalSource {
  return {
    kind: 'referral',
    pending: (caller) =>
      [...referrals.values()]
        .filter((each) => current(each).status === 'proposed')
        .map((each) => ({
          subjectId: each.id,
          proposedAt: each.proposedAt,
          proposerKind: each.proposerKind,
          proposer: resolved(each.proposer, caller),
          summary: {
            grounds: each.grounds,
            caseId: each.caseId,
            cycleYear: each.cycleYear,
            declarantName: each.declarantName,
            personnelFileNumber: each.personnelFileNumber,
            narrativeExcerpt: each.narrative.slice(0, NARRATIVE_EXCERPT),
            evidence: {
              flags: each.sources.flagIds.length,
              clarifications: each.sources.clarificationIds.length,
              obligations: each.sources.obligationIds.length,
              actions: each.sources.actionIds.length,
            },
          },
          cannotApproveReason: cannotApproveReferral(each, casesFor(caller), caller),
        })),
    find: (subjectId) => {
      const found = referrals.get(subjectId);
      if (!found) return null;
      const { status } = current(found);
      return { pending: status === 'proposed', status };
    },
  };
}

function coded(status: number, code: string, detail: string, extra: object = {}) {
  return json(status, {
    type: code,
    title: status === 403 ? 'Forbidden' : status === 409 ? 'Conflict' : 'Error',
    status,
    detail,
    code,
    ...extra,
  });
}

type CannotApprove = 'proposer' | 'reviewer-of-record' | 'role';

/** The separation-of-duties rule (ADR-004): null when the caller may decide it. */
export function cannotApproveReferral(
  found: Referral,
  cases: ReferralCases,
  caller: ReferralCaller,
): CannotApprove | null {
  if (resolved(found.proposer, caller)?.subject === caller.subject) return 'proposer';
  const ofRecord = found.sources.caseIds.flatMap((caseId) => {
    const each = cases.find(caseId);
    return [...(each?.history ?? []), ...(each?.holder ? [each.holder] : [])];
  });
  if (ofRecord.some((each) => each.subject === caller.subject)) return 'reviewer-of-record';
  return caller.roles.includes(SUPERVISOR) ? null : 'role';
}

function refuse(reason: CannotApprove): Response {
  if (reason === 'role') {
    return coded(403, 'supervisor-required', 'Only a supervisor can approve a referral to EACC.', {
      reason,
    });
  }
  return coded(
    403,
    'separation-of-duties',
    reason === 'proposer'
      ? 'You proposed this, so another supervisor must decide it.'
      : 'You reviewed this case, so another supervisor must decide it.',
    { reason },
  );
}

/**
 * Answers the referral endpoints, or null for any other request (the case mock answers those).
 */
export async function referralsRoute(
  request: Request,
  caller: ReferralCaller,
  cases: ReferralCases,
): Promise<Response | null> {
  const { pathname, searchParams } = new URL(request.url);
  const method = request.method;

  const propose = /^\/v1\/review\/cases\/([^/]+)\/referrals$/.exec(pathname);
  if (method === 'POST' && propose?.[1]) {
    const caseId = propose[1];
    const key = request.headers.get('idempotency-key');
    const replayed = key ? replays.get(key) : undefined;
    if (replayed) return json(replayed.status, replayed.body);
    const answer = await proposeOn(request, caseId, caller, cases);
    if (key && answer.status < 500) {
      replays.set(key, { status: answer.status, body: await answer.clone().json() });
    }
    return answer;
  }

  const list = /^\/v1\/commissions\/([^/]+)\/referrals$/.exec(pathname);
  if (method === 'GET' && list?.[1]) return listOf(searchParams, caller);

  const one = /^\/v1\/review\/referrals\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && one?.[1]) {
    const found = referrals.get(one[1]);
    return found ? json(200, view(found, caller, true)) : problem(404, 'Not found');
  }

  const decide = /^\/v1\/review\/referrals\/([^/]+)\/(approve|decline)$/.exec(pathname);
  if (method === 'POST' && decide?.[1] && decide[2]) {
    const found = referrals.get(decide[1]);
    if (!found) return problem(404, 'Not found');
    const verb = decide[2];
    if (verb === 'approve' && !request.headers.get('idempotency-key')) {
      return problem(400, 'Idempotency-Key is required');
    }
    const status = current(found).status;
    if (status !== 'proposed') {
      return coded(409, 'not-proposed', `The referral is ${status}; it no longer waits.`, {
        referralStatus: status,
      });
    }
    const reason = cannotApproveReferral(found, cases, caller);
    if (reason) return refuse(reason);
    const decider = { subject: caller.subject, name: caller.name };
    const at = new Date().toISOString();
    if (verb === 'approve') {
      found.status = 'approved';
      found.approver = decider;
      found.approvedAt = at;
      found.reference = rflReference(at);
      return json(200, view(found, caller, false));
    }
    const body = await readJson(request);
    const note = isRecord(body) ? body.reason : null;
    if (typeof note !== 'string' || !note.trim() || note.length > 2000) {
      return problem(400, 'A note of 1 to 2,000 characters is required');
    }
    found.status = 'declined';
    found.declinedBy = decider;
    found.declinedAt = at;
    found.declineNote = note;
    return json(200, view(found, caller, false));
  }

  return null;
}

const isIdList = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((each) => typeof each === 'string');

async function proposeOn(
  request: Request,
  caseId: string,
  caller: ReferralCaller,
  cases: ReferralCases,
): Promise<Response> {
  const found = cases.find(caseId);
  if (!found) return problem(404, 'Not found');
  if (found.holder?.subject !== caller.subject) {
    return coded(
      403,
      'not-the-assignee',
      "Only the case's assignee can propose a referral from it.",
    );
  }
  const body = await readJson(request);
  const grounds = isRecord(body) ? body.grounds : null;
  const narrative = isRecord(body) ? body.narrative : null;
  const flagIds = isRecord(body) ? body.flagIds : null;
  const clarificationIds = isRecord(body) ? body.clarificationIds : null;
  if (
    (grounds !== 'undeclared-assets' && grounds !== 'unexplained-assets') ||
    typeof narrative !== 'string' ||
    !narrative.trim() ||
    narrative.length > 8000 ||
    !isIdList(flagIds, 100) ||
    flagIds.length === 0 ||
    !isIdList(clarificationIds, 50)
  ) {
    return problem(400, 'Body failed validation');
  }
  const flagsOk = flagIds.every((id) =>
    found.flags.some((flag) => flag.id === id && ASSET_RULES.has(flag.ruleId)),
  );
  const clarificationsOk = clarificationIds.every((id) =>
    found.clarifications.some((each) => each.id === id && each.status !== 'draft'),
  );
  if (!flagsOk || !clarificationsOk) {
    return problem(400, 'A flag or clarification is not one this referral can rest on');
  }
  const open = [...referrals.values()].some(
    (each) => each.caseId === caseId && current(each).status === 'proposed',
  );
  if (open) return coded(409, 'referral-open', 'A referral from this case waits for approval.');
  const referral = stored({
    id: randomUUID(),
    caseId,
    cycleYear: found.item.cycleYear,
    grounds,
    proposerKind: 'user',
    proposer: { subject: caller.subject, name: caller.name },
    proposedAt: new Date().toISOString(),
    narrative: narrative.trim(),
    declarantName: found.item.declarantName,
    personnelFileNumber: found.item.personnelFileNumber,
    sources: { caseIds: [caseId], flagIds, clarificationIds },
    evidence: caseEvidence(found, flagIds, clarificationIds),
  });
  referrals.set(referral.id, referral);
  return json(201, view(referral, caller, false));
}

const STATUSES = new Set(['proposed', 'approved', 'declined', 'sent']);

function listOf(params: URLSearchParams, caller: Assignee): Response {
  const status = params.get('status');
  if (status !== null && !STATUSES.has(status)) return problem(400, 'Unknown status');
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 50) || 50, 1), 100);
  const cursor = params.get('cursor');
  const listed = [...referrals.values()]
    .map(current)
    .filter((each) => status === null || each.status === status)
    .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt) || b.id.localeCompare(a.id));
  let start = 0;
  if (cursor !== null) {
    start = listed.findIndex((each) => each.id === cursor) + 1;
    if (start === 0) return problem(400, 'Unknown cursor');
  }
  const page = listed.slice(start, start + limit);
  const last = page.at(-1);
  return json(200, {
    items: page.map((each) => view(each, caller, false)),
    nextCursor: last && start + limit < listed.length ? last.id : null,
  });
}
