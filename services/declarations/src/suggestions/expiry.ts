import { eq } from 'drizzle-orm';

import type { Transaction } from '../db/transaction.js';
import { suggestionSets } from './schema.js';

/**
 * Registry suggestions expire with the draft (spec 05b S7): in the transaction that discards the
 * draft, submits it (an amendment's resubmit included) or discards an amendment, the declaration
 * row locked, its suggestion sets are deleted; their suggestions cascade. A lookup still running
 * finds its set gone and records nothing (`RegistryLookupSteps`).
 *
 * The consents stay: each is the record of the legal basis its lookups were made on (who asked,
 * when, for whom, the text they agreed to, which registries; identifiers only), which the
 * gateway's results and `declaration.lookup-requested.v1` refer to (ADR-008).
 */
export async function deleteSuggestions(tx: Transaction, declarationId: string): Promise<void> {
  await tx.delete(suggestionSets).where(eq(suggestionSets.declarationId, declarationId));
}
