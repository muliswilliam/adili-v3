import type { DeclarationSectionKey } from '@adili/forms';
import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, ne } from 'drizzle-orm';

import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import type { SectionContents } from '../drafts/sections.js';
import { decisionStands, heldKeys } from './decided.js';
import { declarationSuggestionReopened } from './events.js';
import { findMatchingItem, type MatchKey } from './match-keys.js';
import { statementItems } from './persons.js';
import type { ReopenedSuggestion } from './representation.js';
import { suggestions, suggestionSets, type SuggestionSource } from './schema.js';
import { SuggestionCipher } from './suggestion-cipher.js';
import type { SuggestionRow } from './views.js';

/**
 * Reopening accepted registry suggestions on a section save (spec 05b, S5; CONTEXT.md
 * "Suggestion"): an accepted suggestion of KRA, NTSA, BRS or ArdhiSasa whose item the save deletes,
 * or whose identifier it changes or clears (a plate, a parcel, a spouse's KRA PIN), no longer
 * stands (`decisionStands`) and is offered again: `new`, with no item, matched afresh against the
 * statement as saved. A document's reading is not: it belongs to the item it was read into, and
 * there is nothing to offer it again into. Dismissals stand whatever the draft holds.
 *
 * Weighed before the save's transaction (the key service is not called with a row lock held),
 * written in it: the change commits or rolls back with the section, guarded so a suggestion
 * decided otherwise meanwhile is left alone.
 */

export interface Reopening {
  row: SuggestionRow;
  source: SuggestionSource;
  /** The item the suggestion went into. */
  itemId: string;
  reason: 'item-removed' | 'identifier-changed';
  /** The item it now matches in its statement, if any. */
  matchItemId: string | null;
}

@Injectable()
export class SuggestionReopening {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly cipher: SuggestionCipher,
    private readonly events: EventPublisher,
  ) {}

  /**
   * The accepted registry suggestions of `sectionKey` that saving `contents` over `stored` leaves
   * no longer standing. Only those whose item the save removes or whose identifiers it changes
   * are opened: an edit elsewhere decrypts nothing.
   */
  async weigh(
    person: PersonContext,
    declaration: { id: string; tenant: string },
    sectionKey: DeclarationSectionKey,
    stored: SectionContents,
    contents: SectionContents,
  ): Promise<Reopening[]> {
    // Only these hold items a suggestion goes into; nothing is accepted into the bio.
    if (!holdsItems(sectionKey)) return [];
    const accepted = await withPerson(this.db, person, (tx) =>
      tx
        .select({ row: suggestions, source: suggestionSets.source })
        .from(suggestions)
        .innerJoin(suggestionSets, eq(suggestionSets.id, suggestions.setId))
        .where(
          and(
            eq(suggestions.declarationId, declaration.id),
            eq(suggestions.sectionKey, sectionKey),
            eq(suggestions.status, 'accepted'),
            ne(suggestionSets.source, 'document'),
          ),
        ),
    );
    const touched = accepted.flatMap(({ row, source }) => {
      const itemId = row.acceptedItemId;
      if (itemId === null) return [];
      const now = heldKeys(sectionKey, contents, itemId);
      const before = heldKeys(sectionKey, stored, itemId);
      return now === null || !sameKeys(now, before) ? [{ row, source, itemId, now }] : [];
    });
    const weighed = await Promise.all(
      touched.map(async ({ row, source, itemId, now }): Promise<Reopening[]> => {
        const opened = await this.cipher.open(declaration.tenant, declaration.id, row.id, row);
        const decision = {
          itemType: row.itemType,
          sectionKey,
          status: 'accepted' as const,
          acceptedItemId: itemId,
          matchKeys: opened.matchKeys,
        };
        if (decisionStands(decision, contents)) return [];
        return [
          {
            row,
            source,
            itemId,
            reason: now === null ? 'item-removed' : 'identifier-changed',
            matchItemId: sectionKey.startsWith('statement:')
              ? findMatchingItem(opened, statementItems(contents))
              : row.matchItemId,
          },
        ];
      }),
    );
    return weighed.flat();
  }

  /**
   * In the save's transaction: each suggestion weighed becomes `new` again, with no item, if it
   * is still accepted into the same item, and `declaration.suggestion-reopened.v1` is recorded.
   * The suggestions reopened, by their identifiers.
   */
  async reopen(
    tx: Transaction,
    declaration: { id: string; tenant: string },
    reopenings: readonly Reopening[],
  ): Promise<ReopenedSuggestion[]> {
    const reopened: ReopenedSuggestion[] = [];
    for (const reopening of reopenings) {
      const [updated] = await tx
        .update(suggestions)
        .set({ status: 'new', acceptedItemId: null, matchItemId: reopening.matchItemId })
        .where(
          and(
            eq(suggestions.id, reopening.row.id),
            eq(suggestions.status, 'accepted'),
            eq(suggestions.acceptedItemId, reopening.itemId),
          ),
        )
        .returning();
      if (!updated) continue;
      await this.events.record(
        tx,
        declarationSuggestionReopened(declaration.tenant, {
          declarationId: declaration.id,
          suggestionId: updated.id,
          setId: updated.setId,
          source: reopening.source,
          sectionKey: updated.sectionKey,
          itemId: reopening.itemId,
          reason: reopening.reason,
        }),
      );
      reopened.push({
        id: updated.id,
        setId: updated.setId,
        personKey: updated.personKey,
        sectionKey: updated.sectionKey,
        status: 'new',
        matchItemId: updated.matchItemId,
      });
    }
    return reopened;
  }
}

function holdsItems(sectionKey: string): boolean {
  return (
    sectionKey.startsWith('statement:') || sectionKey === 'household' || sectionKey === 'other'
  );
}

function sameKeys(a: readonly MatchKey[], b: readonly MatchKey[] | null): boolean {
  if (b?.length !== a.length) return false;
  const set = new Set<string>(b);
  return a.every((key) => set.has(key));
}
