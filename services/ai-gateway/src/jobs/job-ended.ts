import type { Database } from '@adili/data-access';
import type { EventPublisher } from '@adili/events';

import type { Job, schema } from '../db/schema.js';
import { auditJob } from '../policy/audit.js';
import { jobFinished } from './events.js';

/**
 * What every job ending writes, in the transaction that ends it: its audit record and its
 * `ai.job.*` event. Hashes and counts only.
 */
export async function recordJobEnded(
  tx: Pick<Database<typeof schema>, 'insert'>,
  events: EventPublisher,
  job: Job,
): Promise<void> {
  await auditJob(tx, job);
  await events.record(tx, jobFinished(job));
}
