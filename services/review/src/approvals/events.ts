import type { ApprovalKind } from './schema.js';

/**
 * `approval.reassigned.v1` (spec 08, outbox): a supervisor pointed an approval at another. The
 * tenant extension is the Commission's slug and the subject the approval's subject id.
 */
export const APPROVAL_REASSIGNED = 'approval.reassigned.v1';

export interface ApprovalReassignedData extends Record<string, unknown> {
  kind: ApprovalKind;
  subjectId: string;
  toSupervisor: string;
  by: string;
}
