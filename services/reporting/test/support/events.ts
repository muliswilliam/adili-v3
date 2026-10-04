import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from '@adili/events';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

/**
 * The events the reporting service projects, as the RabbitMQ transport delivers them, in the
 * shapes their producers publish (declarations spec 04, review spec 07a and spec 08 #206 actions)
 * or have drafted (declarations spec 06); referrals as review spec 08 #212 publishes them.
 */

export function envelope(
  type: string,
  tenant: string,
  subject: string,
  data: Record<string, unknown>,
  time: string,
): EventEnvelope {
  const source =
    type.startsWith('obligation.') || type.startsWith('declaration.')
      ? 'adili/declarations'
      : type.startsWith('ai.')
        ? 'adili/ai-gateway'
        : type.startsWith('access.') || type.startsWith('lea.')
          ? 'adili/access'
          : 'adili/review';
  return {
    specversion: '1.0',
    id: uuidv7(),
    source,
    type,
    time,
    subject,
    datacontenttype: 'application/json',
    tenant,
    data,
  };
}

/** `obligation.created.v1`; an initial obligation due 30 days after `statementDate` by default. */
export function obligationCreated(
  tenant: string,
  fixture: {
    obligationId?: string;
    /** The officer, where the event carries it (a later producer version). */
    personId?: string;
    type: 'initial' | 'biennial' | 'final';
    statementDate: string;
    dueDate?: string;
    time?: string;
  },
): EventEnvelope {
  const obligationId = fixture.obligationId ?? randomUUID();
  const cycleKey =
    fixture.type === 'biennial'
      ? `biennial:${fixture.statementDate.slice(0, 4)}`
      : `${fixture.type}:${fixture.statementDate}`;
  return envelope(
    'obligation.created.v1',
    tenant,
    obligationId,
    {
      obligationId,
      ...(fixture.personId ? { personId: fixture.personId } : {}),
      rosterRecordId: randomUUID(),
      type: fixture.type,
      cycleKey,
      statementDate: fixture.statementDate,
      dueDate: fixture.dueDate ?? addDays(fixture.statementDate, 30),
    },
    fixture.time ?? `${fixture.statementDate}T06:00:00.000Z`,
  );
}

export function obligationStatusChanged(
  tenant: string,
  obligationId: string,
  from: string,
  to: string,
  time: string,
): EventEnvelope {
  return envelope(
    'obligation.status-changed.v1',
    tenant,
    obligationId,
    { obligationId, from, to, reason: to === 'cancelled' ? 'superseded' : null },
    time,
  );
}

/** `declaration.submitted.v1` for version 1 (or an amendment) of the obligation's declaration. */
export function declarationSubmitted(
  tenant: string,
  obligationId: string,
  time: string,
  options: { late?: boolean; amendment?: boolean } = {},
): EventEnvelope {
  const declarationId = randomUUID();
  return envelope(
    'declaration.submitted.v1',
    tenant,
    declarationId,
    {
      declarationId,
      versionId: randomUUID(),
      version: options.amendment ? 2 : 1,
      reference: `DEC-${tenant.toUpperCase()}-2027-0000001-7`,
      type: 'biennial',
      statementDate: '2027-11-01',
      obligationId,
      amendment: options.amendment ?? false,
      late: options.late ?? false,
    },
    time,
  );
}

export function clarificationEvent(
  tenant: string,
  status: 'issued' | 'responded' | 'resolved' | 'overdue' | 'withdrawn',
  ids: { clarificationId: string; caseId: string; personId?: string },
  time: string,
): EventEnvelope {
  return envelope(
    `clarification.${status}.v1`,
    tenant,
    ids.clarificationId,
    { ...ids, ...(status === 'responded' ? { late: false } : {}) },
    time,
  );
}

/** Ladder ids of the fixtures: one ladder per subject. */
const LADDER_NAMESPACE = '6f0e2a4c-8b1d-4f3e-9a5c-2d7b9e1f4a60';

/**
 * An `action.*` event as review publishes it (spec 08 #206 `ActionEventData`): a system-proposed
 * step of the action's ladder (one per subject), approved from `approved` on, with its `ADM`
 * reference; compliance and cancellation name what closed the ladder.
 */
export function actionEvent(
  tenant: string,
  status: 'proposed' | 'approved' | 'declined' | 'issued' | 'responded' | 'complied' | 'cancelled',
  action: {
    actionId: string;
    subjectId: string;
    step: 'notice-to-comply' | 'warning' | 'salary-stoppage' | 'disciplinary-referral';
    subjectKind?: 'obligation' | 'clarification';
    /** The officer, where the event carries it (`action.disciplinary-referred.v1` does). */
    personId?: string;
  },
  time: string,
): EventEnvelope {
  const decided = status !== 'proposed';
  return envelope(
    `action.${status}.v1`,
    tenant,
    action.actionId,
    {
      actionId: action.actionId,
      ladderId: uuidv5(action.subjectId, LADDER_NAMESPACE),
      subjectKind: action.subjectKind ?? 'obligation',
      subjectId: action.subjectId,
      step: action.step,
      ...(action.personId ? { personId: action.personId } : {}),
      proposerKind: 'system',
      approver: decided ? 'reviewer-psc' : null,
      ...(decided && status !== 'declined' ? { reference: 'ADM-PSC-2027-0000001-4' } : {}),
      ...(status === 'complied' ? { cause: 'filed' } : {}),
      ...(status === 'cancelled' ? { cause: 'obligation-cancelled' } : {}),
    },
    time,
  );
}

export function determinationApproved(
  tenant: string,
  ids: { determinationId: string; caseId: string },
  time: string,
): EventEnvelope {
  return envelope(
    'determination.approved.v1',
    tenant,
    ids.determinationId,
    {
      ...ids,
      outcome: 'non-compliant',
      proposerKind: 'reviewer',
      approver: 'supervisor-a',
      reference: `CMP-${tenant.toUpperCase()}-2027-0000001-3`,
    },
    time,
  );
}

/**
 * `referral.sent.v1` as review publishes it (spec 08 #212 `ReferralSentData`): a referral the
 * referral sweep proposed for two missed cycles, approved, with its package issued and sent.
 */
export function referralSent(
  tenant: string,
  referralId: string,
  time: string,
  fixture: { reference?: string; packageDocumentId?: string; personId?: string } = {},
): EventEnvelope {
  return envelope(
    'referral.sent.v1',
    tenant,
    referralId,
    {
      referralId,
      tenant,
      grounds: 'two-missed-cycles',
      cycleYear: 2027,
      personId: fixture.personId ?? randomUUID(),
      proposerKind: 'system',
      approver: `supervisor-${tenant}`,
      reference: fixture.reference ?? `RFL-${tenant.toUpperCase()}-2028-0000001-5`,
      packageDocumentId: fixture.packageDocumentId ?? randomUUID(),
      sentAt: time,
    },
    time,
  );
}

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** `review.copilot.updated.v1` (review spec 07c): the copilot of a case changed status. */
export function copilotUpdated(
  tenant: string,
  fixture: { caseId: string; status: string; time: string },
): EventEnvelope {
  return envelope(
    'review.copilot.updated.v1',
    tenant,
    fixture.caseId,
    { caseId: fixture.caseId, status: fixture.status, forVersionId: randomUUID() },
    fixture.time,
  );
}

/** `ai.feedback.recorded.v1` (ai-gateway spec 07c): a reviewer rated an output or a block of it. */
export function aiFeedbackRecorded(
  tenant: string,
  fixture: {
    feedbackId: string;
    jobId?: string;
    task?: string;
    rating: 'helpful' | 'not-helpful';
    reason?: string | null;
    block?: string | null;
    recordedAt: string;
  },
): EventEnvelope {
  return envelope(
    'ai.feedback.recorded.v1',
    tenant,
    fixture.feedbackId,
    {
      feedbackId: fixture.feedbackId,
      jobId: fixture.jobId ?? randomUUID(),
      task: fixture.task ?? 'summarize-declaration',
      tenant,
      rating: fixture.rating,
      reason: fixture.reason ?? null,
      block: fixture.block ?? null,
      recordedAt: fixture.recordedAt,
    },
    fixture.recordedAt,
  );
}

/** The access-register steps reporting projects (spec 10 `access.request.*`). */
type AccessStep = 'received' | 'decided' | 'cannot-identify' | 'withdrawn';

/** What a test says of one access-register step. */
interface AccessFixture {
  requestId: string;
  at: string;
  outcome?: 'grant' | 'partial-grant' | 'deny';
  grounds?: string[];
}

/**
 * An access-register event of a Form K request (`access.request.*`, Act s.36(1)) as the access
 * service publishes it (spec 10, `packages/events/src/contracts/access.ts`). The subject is the
 * request.
 */
export function accessEvent(
  tenant: string,
  step: AccessStep,
  fixture: AccessFixture,
): EventEnvelope {
  return registerEvent('access.request', 'access-request', 'act-s36-1', tenant, step, fixture);
}

/**
 * An access-register event of a law enforcement request (`lea.request.*`, Act s.36(2)), which
 * Form M section 5 does not count (decided on #239).
 */
export function leaEvent(
  tenant: string,
  step: Exclude<AccessStep, 'cannot-identify'>,
  fixture: AccessFixture,
): EventEnvelope {
  return registerEvent('lea.request', 'lea-request', 'act-s36-2', tenant, step, fixture);
}

function registerEvent(
  stream: 'access.request' | 'lea.request',
  subjectKind: 'access-request' | 'lea-request',
  legalBasis: 'act-s36-1' | 'act-s36-2',
  tenant: string,
  step: AccessStep,
  fixture: AccessFixture,
): EventEnvelope {
  const facts =
    step === 'received'
      ? {
          decisionDeadlineAt: new Date(Date.parse(fixture.at) + 30 * 86_400_000).toISOString(),
        }
      : step === 'decided'
        ? { outcome: fixture.outcome ?? 'grant', grounds: fixture.grounds ?? [] }
        : step === 'cannot-identify'
          ? { declineReason: 'other' }
          : {};
  return envelope(
    `${stream}.${step}.v1`,
    tenant,
    fixture.requestId,
    {
      registerEntryId: randomUUID(),
      subjectKind,
      subjectId: fixture.requestId,
      reference: `ARQ-${tenant.toUpperCase()}-2028-0000001-3`,
      tenant,
      kind: step,
      legalBasis,
      personId: step === 'received' ? null : randomUUID(),
      actor: step === 'received' ? null : `access-officer-${tenant}`,
      at: fixture.at,
      ...facts,
    },
    fixture.at,
  );
}
