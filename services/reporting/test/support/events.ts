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
  ids: { clarificationId: string; caseId: string },
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
