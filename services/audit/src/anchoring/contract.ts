/** Contracts of the audit worker's workflows: plain values, safe in the workflow sandbox. */

export const AUDIT_ANCHORING_WORKFLOW = 'auditAnchoring';

/** The schedule of the daily anchoring, one per task queue. */
export function auditAnchoringScheduleId(taskQueue: string): string {
  return `audit-anchoring:${taskQueue}`;
}

/** A tenant's chain of one UTC day. */
export interface ChainRef {
  tenant: string;
  chainDay: string;
}

export interface AnchoringResult {
  anchored: number;
  verified: number;
  /** Chains whose events, head, anchor or signature no longer match. */
  tampered: ChainRef[];
}
