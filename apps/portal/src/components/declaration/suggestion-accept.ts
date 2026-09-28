import { useCallback } from 'react';

import { acceptDeclarationSuggestion, getDeclarationSection } from '../../server/declarations';
import type { JsonObject, LoadedSection, LoadedSuggestion } from '../../server/declarations.server';
import { useWorkspace } from './workspace';

/**
 * Accepting a suggestion (registry or document): the service writes the item through the
 * section save path with `If-Match`, so it runs under the workspace's `whileHeld` (waiting edits
 * go first, autosave waits). On 409 or 412 the section is read again for a fresh ETag and the
 * accept is tried once more (#312). Afterwards the section is read back, so the screen can show
 * the added or filled item, and its ETag is the one the next save uses.
 */

export interface AcceptInput {
  /** The fields to add, after any edits. */
  fields: JsonObject;
  /** The matching item to fill, or null to add a new one. */
  applyToItemId: string | null;
  overwrite?: boolean;
}

export type AcceptResult =
  | {
      status: 'accepted';
      suggestion: LoadedSuggestion;
      itemId: string;
      /** The suggestion's section as read back after the accept; null if that read failed. */
      section: LoadedSection | null;
      /** The section had changed and was refreshed before the accept went through. */
      retried: boolean;
    }
  | { status: 'failed'; reason: 'conflict' | 'rejected' | 'not-found' | 'unavailable' };

/** `"12"` → 12; 0 when the ETag is not a quoted version. */
function versionOf(etag: string): number {
  const version = Number(etag.replace(/^W\//, '').replaceAll('"', ''));
  return Number.isInteger(version) ? version : 0;
}

export type AcceptSuggestion = (
  suggestion: LoadedSuggestion,
  input: AcceptInput,
  /** Called when the section changed and is being refreshed before the retry. */
  onRefreshing?: () => void,
) => Promise<AcceptResult>;

export function useAcceptSuggestion(): AcceptSuggestion {
  const { declaration, whileHeld } = useWorkspace();
  const declarationId = declaration.id;

  return useCallback(
    async (suggestion, input, onRefreshing) => {
      const sectionKey = suggestion.sectionKey;
      const read = () => getDeclarationSection({ data: { declarationId, sectionKey } });
      try {
        const held = await whileHeld<AcceptResult>(async (etag) => {
          let ifMatch = etag;
          let retried = false;
          let seen: { etag: string; version: number } | null = null;
          for (;;) {
            const outcome = await acceptDeclarationSuggestion({
              data: { declarationId, suggestionId: suggestion.id, ifMatch, ...input },
            });
            if (outcome.status === 'accepted') {
              const fresh = await read();
              const section = fresh.status === 'ok' ? fresh.section : null;
              return {
                value: {
                  status: 'accepted',
                  suggestion: outcome.suggestion,
                  itemId: outcome.itemId,
                  section,
                  retried,
                },
                etag: fresh.status === 'ok' ? fresh.etag : outcome.etag,
                version: section?.draftVersion ?? versionOf(outcome.etag),
              };
            }
            // A suggestion that is no longer new will not accept on a retry either.
            if (outcome.status === 'conflict' && !retried && outcome.code !== 'not-new') {
              retried = true;
              onRefreshing?.();
              const fresh = await read();
              if (fresh.status === 'ok') {
                ifMatch = fresh.etag;
                seen = { etag: fresh.etag, version: fresh.section.draftVersion };
                continue;
              }
            }
            const reason =
              outcome.status === 'conflict' ||
              outcome.status === 'rejected' ||
              outcome.status === 'not-found'
                ? outcome.status
                : 'unavailable';
            return {
              value: { status: 'failed', reason },
              etag: seen?.etag ?? null,
              version: seen?.version ?? 0,
            };
          }
        });
        return held.status === 'done' ? held.value : { status: 'failed', reason: 'conflict' };
      } catch {
        return { status: 'failed', reason: 'unavailable' };
      }
    },
    [declarationId, whileHeld],
  );
}
