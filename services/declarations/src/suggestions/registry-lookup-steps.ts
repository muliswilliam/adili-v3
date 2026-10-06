import type { DeclarationSectionKey } from '@adili/forms';
import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import { declarations, isEditable } from '../declaration/schema.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { requireTransactionEnded } from '../db/workflow-transactions.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { liveDeclaration, sectionsAre } from '../drafts/repository.js';
import { declarationSections } from '../drafts/schema.js';
import type { SectionContents } from '../drafts/sections.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import {
  DECLARANT_REQUEST,
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
} from '../integration-gateway/integration-gateway-client.js';
import { decisionStands, isDecided } from './decided.js';
import { declarationSuggestionsReady } from './events.js';
import { type Comparable, findMatchingItem, repeatsDecided } from './match-keys.js';
import { savedHouseholdPerson } from './household.js';
import { isOfficer, statementItems } from './persons.js';
import { type MappedSuggestion, mapRegistryResult } from './registry-mapping.js';
import type { RegistryResult } from './registry-results.js';
import { type ExtractionFailure, suggestions, suggestionSets } from './schema.js';
import { SuggestionCipher } from './suggestion-cipher.js';
import type {
  LookupAttempt,
  LookupAttemptOutcome,
  LookupFailure,
  LookupRef,
  SetRef,
} from './workflow/contract.js';

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
    // Never read the request's records while the transaction that wrote them is open; one that
    // rolled back left no set, so nothing is looked up (ADR-003 decision 7).
    if (attempt.transactionId) await requireTransactionEnded(this.db, attempt.transactionId);
    const person = personContext(attempt);
    const state = await withPerson(this.db, person, (tx) => setState(tx, attempt));
    if (state === 'past-the-draft') {
      // Nothing is recorded into a declaration past the draft (ADR-018 decision 5).
      await this.settle(attempt, { status: 'failed', reason: 'not-a-draft' });
      return 'recorded';
    }
    if (state !== 'pending') return 'recorded';

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

  /**
   * The set could not be checked at all (a failure that is not the registry's), once the
   * transaction that recorded it has ended: before, there is no set to mark.
   */
  async fail(ref: LookupFailure): Promise<void> {
    if (ref.transactionId) await requireTransactionEnded(this.db, ref.transactionId);
    await this.settle(ref, { status: 'failed' });
  }

  /**
   * The person's national ID: the declarant's from their person record, as verified at onboarding
   * (an audited read in the directory), a spouse's or child's from Household as saved now. Null
   * when there is none any more (the person was taken out, or their ID removed, since the request).
   */
  private async nationalId(ref: LookupRef): Promise<string | null> {
    const { personKey } = ref;
    if (isOfficer(personKey)) {
      return this.directory.getPersonNationalId(ref.tenant, ref.personId);
    }
    const household = await withPerson(this.db, personContext(ref), (tx) =>
      savedHouseholdPerson(
        tx,
        this.sections,
        { id: ref.declarationId, tenant: ref.tenant },
        personKey,
      ),
    );
    return household.listed ? household.nationalId : null;
  }

  /**
   * The declarant's decisions on this registry's suggestions for the person that still stand, for
   * the re-suggestion rule (`repeatsDecided`): every dismissal, and each acceptance whose item is
   * still in the draft with the suggestion's identifier (`decisionStands`).
   */
  private async decided(attempt: LookupAttempt): Promise<Comparable[]> {
    const rows = await withPerson(this.db, personContext(attempt), (tx) =>
      tx
        .select({
          id: suggestions.id,
          itemType: suggestions.itemType,
          sectionKey: suggestions.sectionKey,
          status: suggestions.status,
          acceptedItemId: suggestions.acceptedItemId,
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
    const sections = await this.openSections(
      attempt,
      rows.filter((row) => row.status === 'accepted').map((row) => row.sectionKey),
    );
    const decisions = await Promise.all(
      rows.map(async ({ status, ...row }) =>
        isDecided(status)
          ? [
              {
                itemType: row.itemType,
                sectionKey: row.sectionKey,
                status,
                acceptedItemId: row.acceptedItemId,
                matchKeys: (
                  await this.cipher.open(attempt.tenant, attempt.declarationId, row.id, row)
                ).matchKeys,
              },
            ]
          : [],
      ),
    );
    return decisions
      .flat()
      .filter((decision) => decisionStands(decision, sections.get(decision.sectionKey)));
  }

  /**
   * The suggestions to store, encrypted, each with the item it matches in its statement (the
   * statement as saved now: a match is a hint, re-checked on accept). One that repeats what the
   * declarant has decided on is stored `superseded`, not `new`.
   */
  private async sealed(
    ref: SetRef,
    verificationResultId: string,
    mapped: MappedSuggestion[],
    decided: readonly Comparable[],
  ): Promise<(typeof suggestions.$inferInsert)[]> {
    const statements = await this.openSections(
      ref,
      mapped.map((each) => each.sectionKey).filter((key) => key.startsWith('statement:')),
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
        const statement = statements.get(suggestion.sectionKey);
        return {
          id,
          setId: ref.setId,
          declarationId: ref.declarationId,
          personKey: ref.personKey,
          sectionKey: suggestion.sectionKey,
          itemType: suggestion.itemType,
          ciphertext: sealed.ciphertext,
          envelope: sealed.envelope,
          matchItemId: findMatchingItem(suggestion, statement ? statementItems(statement) : []),
          status: repeatsDecided(suggestion, decided) ? ('superseded' as const) : ('new' as const),
          verificationResultId,
          createdAt: now,
        };
      }),
    );
  }

  /** The draft's sections of these keys as saved now, decrypted, by key (those it has). */
  private async openSections(
    ref: LookupRef,
    sectionKeys: readonly DeclarationSectionKey[],
  ): Promise<Map<DeclarationSectionKey, SectionContents>> {
    const keys = [...new Set(sectionKeys)];
    if (keys.length === 0) return new Map();
    const rows = await withPerson(this.db, personContext(ref), (tx) =>
      tx.select().from(declarationSections).where(sectionsAre(ref.declarationId, keys)),
    );
    return new Map(
      await Promise.all(
        rows.map(
          async (row) => [row.sectionKey, await this.sections.open(ref.tenant, row)] as const,
        ),
      ),
    );
  }

  /**
   * Records the set's outcome, if it is still pending on a draft (one submitted meanwhile fails
   * it `not-a-draft`, ADR-018 decision 5): its status, its suggestions and, when
   * `ready`, `declaration.suggestions-ready.v1` counting the ones stored `new`. A ready set
   * supersedes the `new` suggestions of the person's earlier sets from the same registry; if a
   * later set of theirs is ready already, this one's arrive superseded.
   */
  private async settle(
    ref: SetRef,
    outcome: {
      status: 'ready' | 'unavailable' | 'no-id' | 'failed';
      /** Why a `failed` set failed: only `not-a-draft` for a lookup. */
      reason?: Extract<ExtractionFailure, 'not-a-draft'>;
      verificationResultId?: string | null;
      rows?: (typeof suggestions.$inferInsert)[];
    },
  ): Promise<void> {
    await withPerson(this.db, personContext(ref), async (tx) => {
      // The declaration first, as submission locks it: a submission waits for this record, or
      // this one sees it submitted.
      const declaration = await liveDeclaration(tx, ref.declarationId, { lock: true });
      const [set] = await tx
        .select()
        .from(suggestionSets)
        .where(eq(suggestionSets.id, ref.setId))
        .for('update');
      // Gone with its draft, or recorded already: nothing to record.
      if (!declaration || set?.status !== 'pending') return;
      const recorded: typeof outcome = isEditable(declaration.status)
        ? outcome
        : { status: 'failed', reason: 'not-a-draft' };
      const now = this.clock.now();
      let rows = recorded.rows ?? [];
      if (recorded.status === 'ready') {
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
          status: recorded.status,
          reason: recorded.reason ?? null,
          verificationResultId: recorded.verificationResultId ?? null,
          readyAt: recorded.status === 'ready' ? now : null,
        })
        .where(eq(suggestionSets.id, set.id));
      if (recorded.status === 'ready') {
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

/**
 * The set's state for a lookup: `pending` on a draft (or an amendment in progress), `past-the-draft`
 * when still pending on a declaration no longer editable, `settled` when recorded already, `gone`
 * when there is no such set any more (taken with its draft, or never committed).
 */
async function setState(
  tx: Transaction,
  attempt: LookupAttempt,
): Promise<'pending' | 'past-the-draft' | 'settled' | 'gone'> {
  const [row] = await tx
    .select({ status: suggestionSets.status, declarationStatus: declarations.status })
    .from(suggestionSets)
    .innerJoin(declarations, eq(declarations.id, suggestionSets.declarationId))
    .where(
      and(
        eq(suggestionSets.id, attempt.setId),
        eq(suggestionSets.declarationId, attempt.declarationId),
        ne(declarations.status, 'discarded'),
      ),
    );
  if (!row) return 'gone';
  if (row.status !== 'pending') return 'settled';
  return isEditable(row.declarationStatus) ? 'pending' : 'past-the-draft';
}
