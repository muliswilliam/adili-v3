/**
 * How the access workflows retry their activities (`AccessRequestWorkflow`, `LeaRequestWorkflow`,
 * `CertifiedCopyWorkflow`). Bundled into Temporal's deterministic sandbox: constants and types
 * only.
 */
import type { RetryPolicy } from '@temporalio/workflow';

/**
 * Failure type of an activity whose call another service refused (a 4xx its contract names,
 * `UpstreamRefused`): sending it again changes nothing, so it is not retried.
 */
export const UPSTREAM_REFUSED = 'UpstreamRefused';

/**
 * Failure type of an activity that found a record in a state its workflow should never have
 * reached (e.g. a package to issue for a request with no grant): a bug, not an outage, so it is
 * not retried.
 */
export const INVARIANT_BROKEN = 'InvariantBroken';

/**
 * Failure type of an activity that ran before the transaction that started its workflow had
 * committed or rolled back: retried (with the rest of `ACTIVITY_RETRY`) until it has.
 */
export const TRANSACTION_OPEN = 'TransactionOpen';

/**
 * Outages (the database, the directory, declarations, documents, notifications unreachable) are
 * retried with backoff: the first retry after a second, each later one twice as late, at most
 * five minutes apart, for a hundred attempts (about seven and a half hours). Refusals and broken
 * invariants are not retried at all. Each workflow decides what an activity that finally fails
 * means for its record; none retries it forever.
 */
export const ACTIVITY_RETRY: RetryPolicy = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
  maximumAttempts: 100,
  nonRetryableErrorTypes: [UPSTREAM_REFUSED, INVARIANT_BROKEN],
};
