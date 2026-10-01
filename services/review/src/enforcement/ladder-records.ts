import type { EventPublisher } from '@adili/events';
import { and, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import type { ActionLetterType } from '../documents/documents-client.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import { isCompliance, type LadderStep } from './contract.js';
import { ACTION_CANCELLED, ACTION_COMPLIED, type ActionEventData } from './events.js';
import {
  type ActionStep,
  administrativeActions,
  type ClosingCause,
  enforcementLadders,
  type LadderHistoryKind,
  ladderHistory,
} from './schema.js';

export type ActionRow = typeof administrativeActions.$inferSelect;
export type LadderRow = typeof enforcementLadders.$inferSelect;

/** How letters, messages and views name each step (FE shared label table). */
export const STEP_LABELS: Record<ActionStep, string> = {
  'notice-to-comply': 'Notice to comply',
  warning: 'Warning',
  'salary-stoppage': 'Salary stoppage',
  'disciplinary-referral': 'Disciplinary referral',
};

/** The Restricted letter each drafted step issues as (documents.yaml `DocumentType`). */
export const STEP_LETTERS: Record<LadderStep, ActionLetterType> = {
  'notice-to-comply': 'notice-to-comply',
  warning: 'warning',
  'salary-stoppage': 'salary-stoppage',
  'disciplinary-referral': 'disciplinary-referral',
};

/** The template version of the step letters this service's payload fills. */
export const ACTION_LETTER_TEMPLATE_VERSION = 1;

/** Steps the Commission's review staff decide; the later ones are a supervisor's (spec 08). */
export const REVIEW_STAFF_STEPS: readonly ActionStep[] = ['notice-to-comply', 'warning'];

/** Who may approve or decline a step, for the separation-of-duties rule. */
export function approverRoleOf(step: ActionStep): 'supervisor' | 'review-staff' {
  return REVIEW_STAFF_STEPS.includes(step) ? 'review-staff' : 'supervisor';
}

/** What the declarant has to do to comply (review.yaml `DeclarantNotice.whatToDo`). */
export function whatToDo(ladder: Pick<LadderRow, 'subjectKind'>) {
  return ladder.subjectKind === 'obligation'
    ? ('file-declaration' as const)
    : ('respond-to-clarification' as const);
}

/** A change of an action, as the ladder's history and the event record it. */
export interface ActionChange {
  kind: LadderHistoryKind;
  type: string;
  actor: string;
  at: Date;
  cause?: ClosingCause;
}

/** The ladder history entry and the `action.*` event of a change. */
export async function recordAction(
  tx: ReviewTransaction,
  events: EventPublisher,
  row: ActionRow,
  change: ActionChange,
): Promise<void> {
  await recordHistory(tx, row.tenant, row.ladderId, change.kind, change.actor, change.at, row.id);
  await events.record<ActionEventData>(tx, {
    type: change.type,
    subject: row.id,
    tenant: row.tenant,
    data: {
      actionId: row.id,
      ladderId: row.ladderId,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      step: row.step,
      proposerKind: row.proposerKind,
      approver: row.approver ?? row.declinedBy,
      ...(row.reference === null ? {} : { reference: row.reference }),
      ...(change.cause === undefined ? {} : { cause: change.cause }),
    },
  });
}

/** One entry of the ladder's history. */
export async function recordHistory(
  tx: ReviewTransaction,
  tenant: string,
  ladderId: string,
  kind: LadderHistoryKind,
  actor: string,
  at: Date,
  actionId: string | null = null,
): Promise<void> {
  await tx
    .insert(ladderHistory)
    .values({ id: uuidv7(), tenant, ladderId, actionId, kind, actor, at });
}

/**
 * Steps that went to (or are going to) the declarant: compliance marks them `complied`. A stoppage
 * whose stop payroll has not yet acknowledged is among them: the stop is resumed once it is.
 */
const COMPLIABLE = ['approved', 'approved-pending-payroll', 'issued', 'responded'] as const;

/**
 * Closes an active or declined ladder for `cause`, once: compliance marks its issued steps
 * `complied`; a step still waiting for a decision is `cancelled` either way. A ladder already
 * complied or ended is left as it is. Returns whether anything changed.
 */
export async function closeLadderRecords(
  tx: ReviewTransaction,
  events: EventPublisher,
  ladderId: string,
  cause: ClosingCause,
  at: Date,
): Promise<boolean> {
  const [ladder] = await tx
    .select()
    .from(enforcementLadders)
    .where(eq(enforcementLadders.id, ladderId))
    .for('update');
  if (ladder?.status !== 'active' && ladder?.status !== 'declined') return false;
  const complied = isCompliance(cause);
  await tx
    .update(enforcementLadders)
    .set({
      status: complied ? 'complied' : 'ended',
      closingCause: cause,
      endedAt: ladder.endedAt ?? at,
    })
    .where(eq(enforcementLadders.id, ladderId));
  await recordHistory(
    tx,
    ladder.tenant,
    ladderId,
    complied ? 'ladder-complied' : 'ladder-ended',
    SYSTEM_SUBJECT,
    at,
  );
  if (complied) {
    const done = await tx
      .update(administrativeActions)
      .set({ status: 'complied', compliedAt: at })
      .where(
        and(
          eq(administrativeActions.ladderId, ladderId),
          inArray(administrativeActions.status, COMPLIABLE),
        ),
      )
      .returning();
    for (const row of done) {
      await recordAction(tx, events, row, {
        kind: 'action-complied',
        type: ACTION_COMPLIED,
        actor: SYSTEM_SUBJECT,
        at,
        cause,
      });
    }
  }
  const cancelled = await tx
    .update(administrativeActions)
    .set({ status: 'cancelled', cancelledAt: at })
    .where(
      and(
        eq(administrativeActions.ladderId, ladderId),
        inArray(administrativeActions.status, complied ? ['proposed'] : ['proposed', 'approved']),
      ),
    )
    .returning();
  for (const row of cancelled) {
    await recordAction(tx, events, row, {
      kind: 'action-cancelled',
      type: ACTION_CANCELLED,
      actor: SYSTEM_SUBJECT,
      at,
      cause,
    });
  }
  return true;
}
