import { eq } from 'drizzle-orm';

import type { Transaction } from '../db/transaction.js';
import { suggestionConsents, suggestionSets } from './schema.js';

/**
 * Registry suggestions expire with the draft (spec 05b S7): in the transaction that discards the
 * draft, submits it (an amendment's resubmit included) or discards an amendment, the declaration
 * row locked, its suggestion sets and consents are deleted; their suggestions cascade. The sets
 * go first: a consent's would cascade with it, but a document's set (#315) has none. A lookup
 * still running finds its set gone and records nothing (`RegistryLookupSteps`).
 *
 * The consents are the draft's working copy. The record of each, kept as long as the audit trail
 * is, is its `declaration.lookup-requested.v1` (who consented, on which text, for whom and which
 * registries, when; ADR-008), beside the gateway's record of each lookup made on it.
 */
export async function deleteSuggestions(tx: Transaction, declarationId: string): Promise<void> {
  await tx.delete(suggestionSets).where(eq(suggestionSets.declarationId, declarationId));
  await tx.delete(suggestionConsents).where(eq(suggestionConsents.declarationId, declarationId));
}
