import type { Database } from '@adili/data-access';
import type { NewEvent } from '@adili/events';
import { v7 as uuidv7 } from 'uuid';

import { type AuditAction, auditRecords, type Job, type schema } from '../db/schema.js';

/** The transaction (or database) an audit record is written with. */
type Writer = Pick<Database<typeof schema>, 'insert'>;

/**
 * Audit records (ADR-008): one per finished job and one per policy or budget change, written in
 * the transaction of what they record. Hashes, counts and decisions only.
 */

/** The audit record of a job that has just ended; never its input, output or token map. */
export async function auditJob(tx: Writer, job: Job): Promise<void> {
  await tx.insert(auditRecords).values({
    id: uuidv7(),
    action: 'ai.job.finished',
    tenant: job.tenant,
    actor: job.caller,
    jobId: job.id,
    subjectRef: job.subjectRef,
    task: job.task,
    promptVersion: job.promptVersion,
    dataClass: job.dataClass,
    provider: job.provider,
    model: job.model,
    inputHash: job.inputHash,
    outputHash: job.outputHash,
    tokensIn: job.tokensIn,
    tokensOut: job.tokensOut,
    costMicros: job.costMicros,
    latencyMs: job.latencyMs,
    outcome: job.status,
    reason: job.reason,
  });
}

export const AI_POLICY_CHANGED = 'ai.policy.changed.v1';

export interface PolicyChange {
  action: Exclude<AuditAction, 'ai.job.finished'>;
  tenant: string;
  /** The administrator's subject. */
  actor: string;
  approvalRef: string | null;
  before: unknown;
  after: unknown;
}

export interface AiPolicyChangedData extends Record<string, unknown> {
  action: PolicyChange['action'];
  tenant: string;
  actor: string;
  approvalRef: string | null;
  before: unknown;
  after: unknown;
}

/**
 * The audit record of a policy or budget change, and the `ai.policy.changed.v1` event that
 * carries it to the audit trail. Both hold settings, never content.
 */
export async function auditChange(
  tx: Writer,
  change: PolicyChange,
): Promise<NewEvent<AiPolicyChangedData>> {
  const id = uuidv7();
  await tx.insert(auditRecords).values({
    id,
    action: change.action,
    tenant: change.tenant,
    actor: change.actor,
    approvalRef: change.approvalRef,
    change: { before: change.before, after: change.after },
  });
  return {
    type: AI_POLICY_CHANGED,
    subject: id,
    tenant: change.tenant,
    data: {
      action: change.action,
      tenant: change.tenant,
      actor: change.actor,
      approvalRef: change.approvalRef,
      before: change.before,
      after: change.after,
    },
  };
}
