import { errorType } from '@adili/api-kit';
import type { Logger } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/common';
import { sql } from 'drizzle-orm';

import { workflowUnavailable } from '../drafts/problems.js';
import type { Transaction } from './transaction.js';

/**
 * Starting a workflow inside the transaction that records what it follows (ADR-003 decision 7),
 * as the access service does (its `workflow-control.ts`): the start comes before the commit, so
 * a record never commits without its workflow, and the workflow is passed the transaction's id.
 * Its first activity waits until that transaction has ended (`requireTransactionEnded`): it never
 * reads an uncommitted record as missing, and a rolled-back one ends it.
 */

/** The failure type of an activity whose starting transaction is still open; retried. */
export const TRANSACTION_OPEN = 'TransactionOpen';

/** The id of the open transaction (Postgres `xid8`, as text), assigning one if it has none yet. */
export async function currentTransactionId(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`select pg_current_xact_id()::text as id`);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('The transaction has no id');
  return id;
}

/**
 * Throws a retryable `TRANSACTION_OPEN` failure while `transactionId` is still open. An id old
 * enough that Postgres no longer keeps its status (null) ended long ago.
 */
export async function requireTransactionEnded(
  db: { execute: Transaction['execute'] },
  transactionId: string,
): Promise<void> {
  const result = await db.execute<{ status: string | null }>(
    sql`select pg_xact_status(${transactionId}::xid8) as status`,
  );
  if ((result.rows[0]?.status ?? null) === 'in progress') {
    throw ApplicationFailure.retryable(
      'The transaction that started the workflow is still open',
      TRANSACTION_OPEN,
    );
  }
}

/**
 * Starts a workflow from inside the transaction that records what it answers: Temporal not taking
 * it is logged (`message`, with `fields`) and refused as 503 `workflow-unavailable`, which rolls
 * that transaction back.
 */
export async function startOrRefuse(
  start: () => Promise<unknown>,
  logger: Logger,
  fields: Record<string, string>,
  message: string,
): Promise<void> {
  try {
    await start();
  } catch (error) {
    logger.warn({ ...fields, err: errorType(error) }, message);
    throw workflowUnavailable();
  }
}
