import type { Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { ApplicationFailure } from '@temporalio/common';
import { sql } from 'drizzle-orm';

import { INVARIANT_BROKEN, TRANSACTION_OPEN, UPSTREAM_REFUSED } from './activity-retry.js';
import type { AccessDatabase } from './db/database.js';
import { UpstreamRefused } from './upstream-refusal.js';

/**
 * How the access workflows' activities fail (activity-retry.ts says how each kind is retried).
 * An outage propagates as it is and is retried; the failures below say what it was.
 */

/**
 * Rethrows an error of a call to another service from an activity: a refusal is logged and
 * becomes a non-retryable `UPSTREAM_REFUSED` failure; anything else (an outage) propagates as it
 * is, to be retried, and is not logged here (Temporal records the attempts).
 */
export function rethrowAsActivityFailure(
  logger: Logger,
  error: unknown,
  context: Record<string, unknown>,
  message: string,
): never {
  if (error instanceof UpstreamRefused) {
    logger.error({ ...context, err: errorType(error) }, message);
    throw ApplicationFailure.nonRetryable(message, UPSTREAM_REFUSED);
  }
  throw error;
}

/** A record found in a state its workflow should never have reached: not retried. */
export function invariantBroken(message: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(message, INVARIANT_BROKEN);
}

/**
 * Throws a retryable `TRANSACTION_OPEN` failure while `transactionId`, the transaction that
 * started the workflow (workflow-control.ts `currentTransactionId`), is still open. Its records
 * are only visible to the activity once it commits, and a missing or stale record means
 * something only once it has ended: committed (the record is there to read) or rolled back
 * (there is no record, and the workflow ends). An id old enough that Postgres no longer keeps its
 * status (null) ended long ago.
 */
export async function requireTransactionEnded(
  db: AccessDatabase,
  transactionId: string,
): Promise<void> {
  const result = await db.execute<{ status: string | null }>(
    sql`select pg_xact_status(${transactionId}::xid8) as status`,
  );
  const status = result.rows[0]?.status ?? null;
  if (status === 'in progress') {
    throw ApplicationFailure.retryable(
      'The transaction that started the workflow is still open',
      TRANSACTION_OPEN,
    );
  }
}
