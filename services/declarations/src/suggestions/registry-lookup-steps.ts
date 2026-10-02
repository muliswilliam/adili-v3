import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import { declarations } from '../declaration/schema.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { declarationSections } from '../drafts/schema.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import {
  DECLARANT_REQUEST,
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
} from '../integration-gateway/integration-gateway-client.js';
import { declarationSuggestionsReady } from './events.js';
import { type Comparable, findMatchingItem, repeatsDecided } from './match-keys.js';
import { householdPerson, isOfficer, statementItems } from './persons.js';
import { type MappedSuggestion, mapRegistryResult } from './registry-mapping.js';
import type { RegistryResult } from './registry-results.js';
import { suggestions, suggestionSets } from './schema.js';
import { SuggestionCipher } from './suggestion-cipher.js';
import type { LookupAttempt, LookupAttemptOutcome, LookupRef } from './workflow/contract.js';

/**
 * What the registry lookup workflow does (its activities delegate here), spec 05b S1-S2: one
 * attempt at one registry for one set. The person's national ID is resolved here, at the last
 * moment, and handed only to the gateway; the answer is mapped (`registry-mapping.ts`), matched
 * against the items already declared (`match-keys.ts`), encrypted and stored in one transaction
 * with the set's new status and `declaration.suggestions-ready.v1`. Everything runs under the
 * declarant's row-level security; a set that is gone (the draft was discarded or submitted, or an
 * amendment discarded, which deletes it) or no longer pending (an earlier attempt recorded it) is
 * left alone, so every step is safe to retry and a lookup outliving its draft records nothing.
 */
@Injectable()
export class RegistryLookupSteps {
  private readonly logger = new Logger(RegistryLookupSteps.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly directory: DirectoryClient,
    private readonly gateway: IntegrationGatewayClient,
    private readonly sections: SectionCipher,
    private readonly cipher: SuggestionCipher,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async lookup(attempt: LookupAttempt): Promise<LookupAttemptOutcome> {
    const person = personContext(attempt);
    const pending = await withPerson(this.db, person, (tx) => isPending(tx, attempt));
    if (!pending) return 'recorded';

    const nationalId = await this.nationalId(attempt);
    if (nationalId === null) {
      await this.settle(attempt, { status: 'no-id' });
      return 'recorded';
    }

    let result: RegistryResult | null;
    try {
      result = await this.gateway.lookup({
        system: attempt.system,
        tenant: attempt.tenant,
        nationalId,
        legalBasis: DECLARANT_REQUEST,
        caseRef: attempt.declarationId,
        subjectPersonId: attempt.personId,
      });
    } catch (error) {
      if (!(error instanceof IntegrationGatewayUnavailable)) throw error;
      this.logger.warn(
        { setId: attempt.setId, system: attempt.system, err: error.name },
        'Registry lookup did not reach the gateway',
      );
      result = null;
    }

    if (result === null || result.outcome === 'unavailable') {
      if (!attempt.final) return 'retry';
      await this.settle(attempt, {
        status: 'unavailable',
        verificationResultId: result?.resultId ?? null,
      });
      return 'recorded';
    }

    const mapped = mapRegistryResult(result, attempt.personKey);
    const rows = await this.sealed(
      attempt,
      mapped.verificationResultId,
      mapped.suggestions,
      await this.decided(attempt),
    );
    await this.settle(attempt, {
      status: 'ready',
      verificationResultId: mapped.verificationResultId,
      rows,
    });
    return 'recorded';
  }

  /** The set could not be checked at all (a failure that is not the registry's). */
  async fail(ref: LookupRef & { setId: string }): Promise<void> {
    await this.settle(ref, { status: 'failed' });
  }

  /**
   * The person's national ID: the officer's from their person record, as verified at onboarding
   * (an audited read in the directory), a spouse's or child's from Household as saved now. Null
   * when there is none any more (the person was taken out, or their ID removed, since the request).
   */
  private async nationalId(ref: LookupRef): Promise<string | null> {
    if (isOfficer(ref.personKey)) {
      return this.directory.getPersonNationalId(ref.tenant, ref.personId);
    }
    const section = await withPerson(this.db, personContext(ref), async (tx) => {
      const [row] = await tx
        .select()
        .from(declarationSections)
        .where(
          and(
            eq(declarationSections.declarationId, ref.declarationId),
            eq(declarationSections.sectionKey, 'household'),
          ),
        );
      return row ?? null;
    });
    if (!section) return null;
    const household = householdPerson(await this.sections.open(ref.tenant, section), ref.personKey);
    return household.listed ? household.nationalId : null;
  }

  /**
   * What the declarant has decided on from this registry for the person: their accepted and
   * dismissed suggestions, for the re-suggestion rule (`repeatsDecided`).
   */
  private async decided(attempt: LookupAttempt): Promise<Comparable[]> {
    const rows = await withPerson(this.db, personContext(attempt), (tx) =>
      tx
        .select({
          id: suggestions.id,
          itemType: suggestions.itemType,
          sectionKey: suggestions.sectionKey,
          ciphertext: suggestions.ciphertext,
          envelope: suggestions.envelope,
        })
        .from(suggestions)
        .innerJoin(suggestionSets, eq(suggestionSets.id, suggestions.setId))
        .where(
          and(
            eq(suggestions.declarationId, attempt.declarationId),
            eq(suggestions.personKey, attempt.personKey),
            eq(suggestionSets.source, attempt.system),
            inArray(suggestions.status, ['accepted', 'dismissed']),
          ),
        ),
    );
    return Promise.all(
      rows.map(async (row) => ({
        itemType: row.itemType,
        sectionKey: row.sectionKey,
        matchKeys: (await this.cipher.open(attempt.tenant, attempt.declarationId, row.id, row))
          .matchKeys,
      })),
    );
  }

  /**
   * The suggestions to store, encrypted, each with the item it matches in its statement (the
   * statement as saved now: a match is a hint, re-checked on accept). One that repeats what the
   * declarant has decided on is stored `superseded`, not `new`.
   */
  private async sealed(
    ref: LookupRef & { setId: string },
    verificationResultId: string,
    mapped: MappedSuggestion[],
    decided: readonly Comparable[],
  ): Promise<(typeof suggestions.$inferInsert)[]> {
    const sectionKeys = [...new Set(mapped.map((each) => each.sectionKey))];
    const statements = await withPerson(this.db, personContext(ref), (tx) =>
      sectionKeys.length === 0
        ? Promise.resolve([])
        : tx
            .select()
            .from(declarationSections)
            .where(
              and(
                eq(declarationSections.declarationId, ref.declarationId),
                inArray(
                  declarationSections.sectionKey,
                  sectionKeys.filter((key) => key.startsWith('statement:')),
                ),
              ),
            ),
    );
    const items = new Map(
      await Promise.all(
        statements.map(
          async (section) =>
            [
              section.sectionKey,
              statementItems(await this.sections.open(ref.tenant, section)),
            ] as const,
        ),
      ),
    );
    const now = this.clock.now();
    return Promise.all(
      mapped.map(async (suggestion) => {
        const id = uuidv7();
        const sealed = await this.cipher.seal(ref.tenant, ref.declarationId, id, {
          fields: { ...suggestion.fields },
          sourceRef: suggestion.sourceRef,
          matchKeys: suggestion.matchKeys,
        });
        return {
          id,
          setId: ref.setId,
          declarationId: ref.declarationId,
          personKey: ref.personKey,
          sectionKey: suggestion.sectionKey,
          itemType: suggestion.itemType,
          ciphertext: sealed.ciphertext,
          envelope: sealed.envelope,
          matchItemId: findMatchingItem(suggestion, items.get(suggestion.sectionKey) ?? []),
          status: repeatsDecided(suggestion, decided) ? ('superseded' as const) : ('new' as const),
          verificationResultId,
          createdAt: now,
        };
      }),
    );
  }

  /**
   * Records the set's outcome, if it is still pending: its status, its suggestions and, when
   * `ready`, `declaration.suggestions-ready.v1` counting the ones stored `new`. A ready set
   * supersedes the `new` suggestions of the person's earlier sets from the same registry; if a
   * later set of theirs is ready already, this one's arrive superseded.
   */
  private async settle(
    ref: LookupRef & { setId: string },
    outcome: {
      status: 'ready' | 'unavailable' | 'no-id' | 'failed';
      verificationResultId?: string | null;
      rows?: (typeof suggestions.$inferInsert)[];
    },
  ): Promise<void> {
    await withPerson(this.db, personContext(ref), async (tx) => {
      const [set] = await tx
        .select()
        .from(suggestionSets)
        .where(eq(suggestionSets.id, ref.setId))
        .for('update');
      // Gone with its draft, or recorded already: nothing to record.
      if (set?.status !== 'pending') return;
      const now = this.clock.now();
      let rows = outcome.rows ?? [];
      if (outcome.status === 'ready') {
        const sameRegistry = and(
          eq(suggestionSets.declarationId, set.declarationId),
          eq(suggestionSets.personKey, set.personKey),
          eq(suggestionSets.source, set.source),
          ne(suggestionSets.id, set.id),
        );
        const earlier = tx
          .select({ id: suggestionSets.id })
          .from(suggestionSets)
          .where(and(sameRegistry, lt(suggestionSets.requestedAt, set.requestedAt)));
        await tx
          .update(suggestions)
          .set({ status: 'superseded' })
          .where(and(inArray(suggestions.setId, earlier), eq(suggestions.status, 'new')));
        const [later] = await tx
          .select({ id: suggestionSets.id })
          .from(suggestionSets)
          .where(
            and(
              sameRegistry,
              gt(suggestionSets.requestedAt, set.requestedAt),
              eq(suggestionSets.status, 'ready'),
            ),
          )
          .limit(1);
        if (later) rows = rows.map((row) => ({ ...row, status: 'superseded' as const }));
        if (rows.length > 0) await tx.insert(suggestions).values(rows);
      }
      await tx
        .update(suggestionSets)
        .set({
          status: outcome.status,
          verificationResultId: outcome.verificationResultId ?? null,
          readyAt: outcome.status === 'ready' ? now : null,
        })
        .where(eq(suggestionSets.id, set.id));
      if (outcome.status === 'ready') {
        await this.events.record(
          tx,
          declarationSuggestionsReady(ref.tenant, {
            declarationId: set.declarationId,
            setId: set.id,
            source: set.source,
            // What the declarant is offered: the suggestions stored `new`.
            count: rows.filter((row) => row.status === 'new').length,
          }),
        );
      }
    });
  }
}

function personContext(ref: Pick<LookupRef, 'personId' | 'subject'>): PersonContext {
  return { personId: ref.personId, subject: ref.subject };
}

/** Whether the set is still pending on a live draft. */
async function isPending(tx: Transaction, attempt: LookupAttempt): Promise<boolean> {
  const [row] = await tx
    .select({ status: suggestionSets.status })
    .from(suggestionSets)
    .innerJoin(declarations, eq(declarations.id, suggestionSets.declarationId))
    .where(
      and(
        eq(suggestionSets.id, attempt.setId),
        eq(suggestionSets.declarationId, attempt.declarationId),
        ne(declarations.status, 'discarded'),
      ),
    );
  return row?.status === 'pending';
}
