import { Injectable, Logger, Module } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { config } from '../config.js';
import type { AccessTransaction } from '../db/database.js';
import { workflowUnavailable } from '../problems.js';
import {
  CERTIFIED_COPY_WORKFLOW,
  type CertifiedCopyWorkflowInput,
  certifiedCopyWorkflowId,
} from './contract.js';
import { certifiedCopies } from './schema.js';
import type { certifiedCopy } from './workflows.js';

export type CertifiedCopyRow = typeof certifiedCopies.$inferSelect;

/** A certified copy to issue: which version, for whom, asked by whom. */
export interface CertifiedCopyOrder {
  /** The Commission the declaration was filed with. */
  tenant: string;
  commissionName: string;
  /** The declarant: the copy's subject, the only one who may download it. */
  personId: string;
  declarationId: string;
  version: number;
  /** Token subject and name of who asked: the declarant, or the access officer recording it. */
  requestedBy: { subject: string; name: string | null };
  /** The officer-recorded self-access application; null when the declarant asks online. */
  applicationId: string | null;
  at: Date;
}

/**
 * Orders certified copies (spec 10, Administrative Mechanism 32): the one way a copy comes to be,
 * whether the declarant asks in the portal or the access officer records a written application
 * (#303). The copy is recorded `pending` and `CertifiedCopyWorkflow` started as the last step of
 * the caller's transaction, which must run in the Commission's context: Temporal unreachable is
 * 503 and nothing is recorded. The workflow fetches the version in full from declarations, has
 * documents issue it as the declarant's Restricted `certified-copy` and registers it
 * `self-access` (`CertifiedCopyActivities`).
 *
 * One copy per version and way of asking (per application): ordering it again returns it as it
 * is (a pending one with its workflow started again should it have stopped), and a failed one is
 * tried again.
 */
@Injectable()
export class CertifiedCopyIssuance {
  private readonly logger = new Logger(CertifiedCopyIssuance.name);

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async order(tx: AccessTransaction, order: CertifiedCopyOrder): Promise<CertifiedCopyRow> {
    const copy = await this.record(tx, order);
    if (copy.status === 'pending') await this.start({ tenant: copy.tenant, copyId: copy.id });
    return copy;
  }

  private async record(
    tx: AccessTransaction,
    order: CertifiedCopyOrder,
  ): Promise<CertifiedCopyRow> {
    const asked = {
      requestedBy: order.requestedBy.subject,
      requestedByName: order.requestedBy.name,
      requestedAt: order.at,
    };
    await tx
      .insert(certifiedCopies)
      .values({
        id: uuidv7(),
        tenant: order.tenant,
        commissionName: order.commissionName,
        personId: order.personId,
        declarationId: order.declarationId,
        version: order.version,
        status: 'pending',
        applicationId: order.applicationId,
        ...asked,
      })
      .onConflictDoNothing({
        target: [
          certifiedCopies.personId,
          certifiedCopies.declarationId,
          certifiedCopies.version,
          certifiedCopies.applicationId,
        ],
      });
    const [found] = await tx
      .select()
      .from(certifiedCopies)
      .where(
        and(
          eq(certifiedCopies.personId, order.personId),
          eq(certifiedCopies.declarationId, order.declarationId),
          eq(certifiedCopies.version, order.version),
          order.applicationId === null
            ? isNull(certifiedCopies.applicationId)
            : eq(certifiedCopies.applicationId, order.applicationId),
        ),
      )
      .for('update');
    if (!found) throw new Error('The certified copy was not recorded');
    if (found.status !== 'failed') return found;
    // Asked again after declarations had no such version: try again, as asked now.
    const [retried] = await tx
      .update(certifiedCopies)
      .set({ status: 'pending', failedAt: null, commissionName: order.commissionName, ...asked })
      .where(eq(certifiedCopies.id, found.id))
      .returning();
    if (!retried) throw new Error('The certified copy was not recorded');
    return retried;
  }

  private async start(input: CertifiedCopyWorkflowInput): Promise<void> {
    try {
      // By name: workflow code is loaded by the worker's bundler, not by this process.
      await this.temporal.workflow.start<typeof certifiedCopy>(CERTIFIED_COPY_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: certifiedCopyWorkflowId(input.copyId),
        args: [input],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      this.logger.error(
        { copyId: input.copyId, err: errorType(error) },
        'Could not start CertifiedCopyWorkflow',
      );
      throw workflowUnavailable(
        'The certified copy cannot be prepared right now. Try again shortly.',
      );
    }
  }
}

/** `CertifiedCopyIssuance` for the modules that order certified copies. */
@Module({ providers: [CertifiedCopyIssuance], exports: [CertifiedCopyIssuance] })
export class CertifiedCopyIssuanceModule {}
