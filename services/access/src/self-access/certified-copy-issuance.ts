import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { AccessTransaction } from '../db/database.js';
import { currentTransactionId, startWorkflow } from '../workflow-control.js';
import {
  CERTIFIED_COPY_WORKFLOW,
  type CertifiedCopyWorkflowInput,
  certifiedCopyWorkflowId,
} from './contract.js';
import { certifiedCopies } from './schema.js';

export type CertifiedCopyRow = typeof certifiedCopies.$inferSelect;

/** A certified copy to issue: which version, for whom, asked by whom. */
export interface CertifiedCopyOrder {
  /** The Commission the declaration was filed with. */
  tenant: string;
  commissionName: string;
  /** The declarant: the copy's subject, who may download it (as may an application's officer). */
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
 * (#303). The copy is recorded `pending` and `CertifiedCopyWorkflow` started in the caller's
 * transaction, which must run in the Commission's context, before it commits: Temporal
 * unreachable is 503 and nothing is recorded, and the workflow reads the copy only once that
 * transaction has ended (workflow-control.ts). The workflow fetches the version in full from
 * declarations, has documents issue it as the declarant's Restricted `certified-copy` and
 * registers it `self-access` (`CertifiedCopyActivities`).
 *
 * One copy per version and way of asking (per application): ordering it again returns it as it
 * is (a pending one with its workflow started again should it have stopped), and a failed one is
 * tried again, in a new run (the run that recorded it failed is terminated should it not have
 * closed yet).
 */
@Injectable()
export class CertifiedCopyIssuance {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async order(tx: AccessTransaction, order: CertifiedCopyOrder): Promise<CertifiedCopyRow> {
    const { copy, retried } = await this.record(tx, order);
    if (copy.status === 'pending') {
      await this.start(
        { tenant: copy.tenant, copyId: copy.id, transactionId: await currentTransactionId(tx) },
        // The run that recorded it failed may not have closed yet: it is replaced, not kept.
        retried,
      );
    }
    return copy;
  }

  /** The copy as ordered now, and whether it was a failed one, now tried again. */
  private async record(
    tx: AccessTransaction,
    order: CertifiedCopyOrder,
  ): Promise<{ copy: CertifiedCopyRow; retried: boolean }> {
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
    if (found.status !== 'failed') return { copy: found, retried: false };
    // Asked again after declarations had no such version: try again, as asked now.
    const [retried] = await tx
      .update(certifiedCopies)
      .set({ status: 'pending', failedAt: null, commissionName: order.commissionName, ...asked })
      .where(eq(certifiedCopies.id, found.id))
      .returning();
    if (!retried) throw new Error('The certified copy was not recorded');
    return { copy: retried, retried: true };
  }

  private async start(input: CertifiedCopyWorkflowInput, replaceRunning: boolean): Promise<void> {
    await startWorkflow(this.temporal, {
      type: CERTIFIED_COPY_WORKFLOW,
      workflowId: certifiedCopyWorkflowId(input.copyId),
      args: [input],
      unavailable: 'The certified copy cannot be prepared right now. Try again shortly.',
      replaceRunning,
    });
  }
}

/** `CertifiedCopyIssuance` for the modules that order certified copies. */
@Module({ providers: [CertifiedCopyIssuance], exports: [CertifiedCopyIssuance] })
export class CertifiedCopyIssuanceModule {}
