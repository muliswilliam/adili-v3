import type { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import type {
  PayrollAction,
  PayrollInstruction,
} from '../integration-gateway/integration-gateway-client.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import { isCompliance } from './contract.js';
import {
  ACTION_REINSTATED,
  PAYROLL_INSTRUCTION_ACKNOWLEDGED,
  PAYROLL_INSTRUCTION_SENT,
  type PayrollInstructionData,
} from './events.js';
import { type ActionRow, type LadderRow, recordAction, recordHistory } from './ladder-records.js';
import { administrativeActions, type PayrollAcknowledgement } from './schema.js';

/** The instruction reference of a stoppage's resume: its `ADM` reference with `-R`. */
export function resumeReference(reference: string): string {
  return `${reference}-R`;
}

/**
 * Why payroll is instructed, as the instruction carries it: the action's reference and the kind of
 * failure; for a resume, why the ladder ended. No names, file numbers or amounts.
 */
export function payrollReason(
  action: PayrollAction,
  ladder: Pick<LadderRow, 'subjectKind' | 'closingCause'>,
  reference: string,
): string {
  const failure =
    ladder.subjectKind === 'obligation'
      ? 'failure to file a declaration of income, assets and liabilities'
      : 'failure to respond to a request for clarification';
  if (action === 'stop_salary') {
    return `Salary stoppage ${reference} under the Administrative Mechanisms for ${failure}`;
  }
  if (ladder.closingCause !== null && !isCompliance(ladder.closingCause)) {
    const ended =
      ladder.closingCause === 'obligation-cancelled'
        ? 'filing obligation cancelled'
        : 'clarification withdrawn';
    return `Administrative action ended (${ended}) after salary stoppage ${reference}: salary reinstated`;
  }
  return `Compliance after salary stoppage ${reference}: salary reinstated`;
}

/** The acknowledgement as the action keeps it (review.yaml `PayrollAck`). */
export function acknowledgement(instruction: PayrollInstruction): PayrollAcknowledgement {
  return {
    instructionReference: instruction.instructionReference,
    action: instruction.action,
    status: instruction.status,
    payrollReference: instruction.payrollReference,
    receivedAt: instruction.receivedAt,
  };
}

/**
 * Records the instruction as about to be sent, once per reference: the history entry and
 * `payroll.instruction.sent.v1`. The stop also marks the stoppage `approved-pending-payroll` and
 * fixes its effective date, so a retry sends the same instruction.
 */
export async function recordInstructionSent(
  tx: ReviewTransaction,
  events: EventPublisher,
  action: ActionRow,
  instruction: { action: PayrollAction; reference: string; effectiveDate: string },
  at: Date,
): Promise<ActionRow> {
  const stop = instruction.action === 'stop_salary';
  const already = stop ? action.payrollStopReference : action.payrollResumeReference;
  if (already !== null) return action;
  const [updated] = await tx
    .update(administrativeActions)
    .set(
      stop
        ? {
            payrollStopReference: instruction.reference,
            salaryStopEffectiveDate: instruction.effectiveDate,
            ...(action.status === 'approved'
              ? { status: 'approved-pending-payroll' as const }
              : {}),
          }
        : { payrollResumeReference: instruction.reference },
    )
    .where(eq(administrativeActions.id, action.id))
    .returning();
  const row = updated ?? action;
  await recordHistory(
    tx,
    row.tenant,
    row.ladderId,
    'payroll-instruction-sent',
    SYSTEM_SUBJECT,
    at,
    row.id,
  );
  await events.record<PayrollInstructionData>(tx, {
    type: PAYROLL_INSTRUCTION_SENT,
    subject: row.id,
    tenant: row.tenant,
    data: {
      actionId: row.id,
      ladderId: row.ladderId,
      instructionReference: instruction.reference,
      action: instruction.action,
    },
  });
  return row;
}

/**
 * Stores payroll's acknowledgement, once per instruction, with the history entry and
 * `payroll.instruction.acknowledged.v1`. An acknowledged stop takes the stoppage from
 * `approved-pending-payroll` back to `approved` (its letter follows); an acknowledged resume makes
 * it `reinstated`, with `action.reinstated.v1`.
 */
export async function recordInstructionAcknowledged(
  tx: ReviewTransaction,
  events: EventPublisher,
  action: ActionRow,
  instruction: PayrollInstruction,
  at: Date,
): Promise<ActionRow> {
  const stop = instruction.action === 'stop_salary';
  const stored = stop ? action.payrollStopAck : action.payrollResumeAck;
  if (stored !== null) return action;
  const ack = acknowledgement(instruction);
  const [updated] = await tx
    .update(administrativeActions)
    .set(
      stop
        ? {
            payrollStopAck: ack,
            salaryStoppedAt: at,
            ...(action.status === 'approved-pending-payroll'
              ? { status: 'approved' as const }
              : {}),
          }
        : { payrollResumeAck: ack, salaryReinstatedAt: at, status: 'reinstated' },
    )
    .where(eq(administrativeActions.id, action.id))
    .returning();
  const row = updated ?? action;
  await recordHistory(
    tx,
    row.tenant,
    row.ladderId,
    'payroll-instruction-acknowledged',
    SYSTEM_SUBJECT,
    at,
    row.id,
  );
  await events.record<PayrollInstructionData>(tx, {
    type: PAYROLL_INSTRUCTION_ACKNOWLEDGED,
    subject: row.id,
    tenant: row.tenant,
    data: {
      actionId: row.id,
      ladderId: row.ladderId,
      instructionReference: instruction.instructionReference,
      action: instruction.action,
      status: instruction.status,
      payrollReference: instruction.payrollReference,
    },
  });
  if (!stop) {
    await recordAction(tx, events, row, {
      kind: 'action-reinstated',
      type: ACTION_REINSTATED,
      actor: SYSTEM_SUBJECT,
      at,
    });
  }
  return row;
}
