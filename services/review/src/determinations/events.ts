import type { ProposerKind } from '../approvals/schema.js';
import type { DeterminationOutcome } from './schema.js';

/**
 * Events the review service publishes about compliance determinations (spec 08, outbox,
 * CloudEvents). Identifiers, outcomes and actors only: never reasons, names or the declaration.
 * The tenant extension is the Commission's slug and the subject the determination id.
 */
export const DETERMINATION_PROPOSED = 'determination.proposed.v1';
export const DETERMINATION_APPROVED = 'determination.approved.v1';
export const DETERMINATION_RETURNED = 'determination.returned.v1';
export const DETERMINATION_WITHDRAWN = 'determination.withdrawn.v1';

/** Every `determination.*` event. */
export interface DeterminationEventData extends Record<string, unknown> {
  determinationId: string;
  caseId: string;
  outcome: DeterminationOutcome;
  proposerKind: ProposerKind;
  /** The supervisor who approved or returned it; null until then. */
  approver: string | null;
  /** `determination.approved.v1` only: the `CMP` reference allocated. */
  reference?: string;
}
