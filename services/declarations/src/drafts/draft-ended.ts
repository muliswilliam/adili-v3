import { deleteConversations } from '../assistant/expiry.js';
import type { Transaction } from '../db/transaction.js';
import { deleteSuggestions } from '../suggestions/expiry.js';

/**
 * What lives only as long as the draft (the declarant's working copy) and goes with it: its
 * registry suggestions (spec 05b S7) and its Ask Adili conversation (spec 11 S7). Called in the
 * transaction that discards the draft, submits it (an amendment's resubmit included) or discards
 * an amendment, with the declaration row locked.
 */
export async function deleteWhatGoesWithTheDraft(
  tx: Transaction,
  declarationId: string,
): Promise<void> {
  await deleteSuggestions(tx, declarationId);
  await deleteConversations(tx, declarationId);
}
