import type { ProposerKind } from '../approvals/schema.js';
import type { ActionStep, ClosingCause, SubjectKind } from './schema.js';

/**
 * Events the review service publishes about the enforcement ladder (spec 08, outbox,
 * CloudEvents). Identifiers, steps, states and actors only: never names, notes, responses or letter
 * text. The tenant extension is the Commission's slug; the subject the action id (the ladder id
 * for `ladder.*`).
 */
export const ACTION_PROPOSED = 'action.proposed.v1';
export const ACTION_APPROVED = 'action.approved.v1';
export const ACTION_DECLINED = 'action.declined.v1';
export const ACTION_ISSUED = 'action.issued.v1';
export const ACTION_RESPONDED = 'action.responded.v1';
export const ACTION_COMPLIED = 'action.complied.v1';
export const ACTION_CANCELLED = 'action.cancelled.v1';
export const ACTION_REINSTATED = 'action.reinstated.v1';
/** For the employer (the reporting entity) to open disciplinary proceedings (spec 08 step 4). */
export const ACTION_DISCIPLINARY_REFERRED = 'action.disciplinary-referred.v1';
export const LADDER_RESTARTED = 'ladder.restarted.v1';
export const PAYROLL_INSTRUCTION_SENT = 'payroll.instruction.sent.v1';
export const PAYROLL_INSTRUCTION_ACKNOWLEDGED = 'payroll.instruction.acknowledged.v1';

/** Every `action.*` event. */
export interface ActionEventData extends Record<string, unknown> {
  actionId: string;
  ladderId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  step: ActionStep;
  proposerKind: ProposerKind;
  /** The officer who approved or declined it; null until then. */
  approver: string | null;
  /** From approval on: the `ADM` reference allocated. */
  reference?: string;
  /** `action.complied.v1` and `action.cancelled.v1`: what closed the ladder. */
  cause?: ClosingCause;
}

/**
 * `action.disciplinary-referred.v1`: the issued referral, with the roster record and reporting
 * entity it is for (identifiers only), so the employer can act on it.
 */
export interface DisciplinaryReferredData extends ActionEventData {
  personId: string | null;
  rosterRecordId: string | null;
  reportingEntityId: string | null;
}

/**
 * `payroll.instruction.sent.v1` and `payroll.instruction.acknowledged.v1`: an instruction of a
 * salary stoppage, by its reference (the `ADM` reference, `-R` for the resume); the
 * acknowledgement adds payroll's status and reference.
 */
export interface PayrollInstructionData extends Record<string, unknown> {
  actionId: string;
  ladderId: string;
  instructionReference: string;
  action: 'stop_salary' | 'resume_salary';
  status?: string;
  payrollReference?: string | null;
}

/** `ladder.restarted.v1`: a supervisor restarted a declined ladder at a step. */
export interface LadderRestartedData extends Record<string, unknown> {
  ladderId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  step: ActionStep;
  run: number;
  by: string;
}
