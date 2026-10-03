import { sql } from 'drizzle-orm';

import type { Transaction } from '../commissions/commissions.service.js';

/** A person id before the row exists: the account carries it as `person_id`. */
export async function newPersonId(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`select uuidv7() as id`);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('uuidv7() returned no id');
  return id;
}
