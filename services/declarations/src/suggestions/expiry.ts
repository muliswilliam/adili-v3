import { eq } from 'drizzle-orm';

import type { Transaction } from '../db/transaction.js';
import { suggestionConsents, suggestionSets } from './schema.js';

/**
 * Registry suggestions expire with the draft (spec 05b S7): in the transaction that discards the
 * draft, submits it (an amendment's resubmit included) or discards an amendment, the declaration
 * row locked, its suggestion sets and consents are deleted; their suggestions cascade. A lookup
 * still running finds its set gone and records nothing (`RegistryLookupSteps`).
 */
export async function deleteSuggestions(tx: Transaction, declarationId: string): Promise<void> {
  await tx.delete(suggestionSets).where(eq(suggestionSets.declarationId, declarationId));
  await tx.delete(suggestionConsents).where(eq(suggestionConsents.declarationId, declarationId));
}
