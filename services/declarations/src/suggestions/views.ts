import type { Suggestion, SuggestionSet } from './representation.js';
import type { suggestions, suggestionSets } from './schema.js';

/** The rows of the suggestions tables as the API shows them, contents decrypted by the caller. */

export type SetRow = typeof suggestionSets.$inferSelect;
export type SuggestionRow = typeof suggestions.$inferSelect;

export function setView(set: SetRow, own: Suggestion[]): SuggestionSet {
  return {
    id: set.id,
    personKey: set.personKey,
    source: set.source,
    status: set.status,
    requestedAt: set.requestedAt.toISOString(),
    readyAt: set.readyAt?.toISOString() ?? null,
    verificationResultId: set.verificationResultId,
    aiJobId: set.aiJobId,
    attachmentId: set.attachmentId,
    documentKind: set.documentKind,
    reason: set.reason,
    suggestions: own,
  };
}

export function suggestionView(
  row: SuggestionRow,
  contents: { fields: Record<string, unknown>; sourceRef: Record<string, unknown> },
): Suggestion {
  return {
    id: row.id,
    setId: row.setId,
    personKey: row.personKey,
    sectionKey: row.sectionKey,
    itemType: row.itemType,
    fields: contents.fields,
    sourceRef: contents.sourceRef,
    confidence: row.confidence,
    matchItemId: row.matchItemId,
    status: row.status,
    acceptedItemId: row.acceptedItemId,
  };
}
