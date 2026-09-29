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
export const LADDER_RESTARTED = 'ladder.restarted.v1';

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

/** `ladder.restarted.v1`: a supervisor restarted a declined ladder at a step. */
export interface LadderRestartedData extends Record<string, unknown> {
  ladderId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  step: ActionStep;
  run: number;
  by: string;
}
