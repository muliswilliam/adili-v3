import { eq } from 'drizzle-orm';

import type { AccessTransaction } from '../db/database.js';
import type { AccessRequestRow } from './representation.js';
import { accessRequests } from './schema.js';

/**
 * The request `requestId` as the transaction's context sees it (the Commission's, for officer
 * work), locked for update when `lock`; undefined when it sees none.
 */
export async function requestRow(
  tx: AccessTransaction,
  requestId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<AccessRequestRow | undefined> {
  const query = tx.select().from(accessRequests).where(eq(accessRequests.id, requestId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}
