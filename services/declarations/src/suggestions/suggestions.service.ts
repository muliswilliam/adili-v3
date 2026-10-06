import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { ITEM_SOURCE_KINDS, type ItemSource, type PersonKey } from '@adili/forms';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import { isEditable } from '../declaration/schema.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { currentTransactionId, startOrRefuse } from '../db/workflow-transactions.js';
import { isRecord, isUuid } from '../guards.js';
import { personOf } from '../drafts/access.js';
import { DraftsService } from '../drafts/drafts.service.js';
import { declarationNotDraft, fieldErrors, validationProblem } from '../drafts/problems.js';
import { type DeclarationRow, liveDeclaration } from '../drafts/repository.js';
import type { StoredEnvelope } from '../drafts/schema.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import { isStatementKey } from '../drafts/sections.js';
import { etag } from '../http.js';
import { placementOf } from './acceptance.js';
import { readingPlacementOf } from './document-acceptance.js';
import {
  declarationLookupRequested,
  declarationSuggestionAccepted,
  declarationSuggestionDismissed,
} from './events.js';
import { savedHouseholdPerson } from './household.js';
import { isHouseholdPersonKey, isOfficer, isPersonKey } from './persons.js';
import { RegistryLookupWorkflows } from './registry-lookup-workflows.js';
import {
  acceptSuggestionRequestSchema,
  dismissSuggestionRequestSchema,
  type RegistryLookupRequest,
  registryLookupRequestSchema,
  type Suggestion,
  type SuggestionAcceptance,
  type SuggestionSet,
} from './representation.js';
import { SUGGESTION_SOURCES, suggestionConsents, suggestions, suggestionSets } from './schema.js';
import { SuggestionCipher } from './suggestion-cipher.js';
import { type SetRow, setView, type SuggestionRow, suggestionView } from './views.js';

export interface SuggestionsQuery {
  personKey?: string;
  sectionKey?: string;
}

/**
 * Registry suggestions on a draft (spec 05b): the declarant asks, with their consent recorded,
 * for registries to be checked for a person of their household, and lists what came back. Every
 * route is the declarant's own by the `person_id` claim, under person-scoped row-level security;
 * anyone else, staff included, gets 404. The lookups themselves run in a workflow
 * (`RegistryLookupsWorkflow`); suggestions never change a section (accept does, #311).
 */
@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly sections: SectionCipher,
    private readonly cipher: SuggestionCipher,
    private readonly workflows: RegistryLookupWorkflows,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly drafts: DraftsService,
  ) {}

  /**
   * Records the declarant's consent and one `pending` set per registry asked, announces the
   * request, and starts the lookups (S1). 400 `consent-required` without the declarant's request,
   * `no-id` for a spouse or child without a national ID in Household (S2), a validation problem
   * for anything else malformed or a person not in the household; 404 when the draft is not the
   * caller's; 409 when it is past the draft.
   */
  async requestLookups(
    principal: Principal,
    declarationId: string,
    body: unknown,
  ): Promise<SuggestionSet[]> {
    const person = personOf(principal);
    const request = parseRequest(body);
    const systems = [...new Set(request.systems)];
    const now = this.clock.now();
    const consentId = uuidv7();
    const planned = systems.map((system) => ({ setId: uuidv7(), system }));

    const recorded = await withPerson(this.db, person, async (tx) => {
      // Checked unlocked first: the workflow is started before this transaction takes a lock
      // others queue for (ADR-003 decision 7), with its id, so a request never commits without
      // the workflow that answers its sets, and Temporal unreachable rolls it back (503
      // `workflow-unavailable`; the declarant asks again).
      const found = await liveDeclaration(tx, declarationId);
      if (!found) return null;
      if (!isEditable(found.status)) throw declarationNotDraft('edited');
      const personKey = await this.checkPerson(tx, found, request.personKey);
      const transactionId = await currentTransactionId(tx);
      await startOrRefuse(
        () =>
          this.workflows.start({
            tenant: found.tenant,
            declarationId: found.id,
            personId: person.personId,
            subject: person.subject,
            personKey,
            consentId,
            sets: planned,
            transactionId,
          }),
        this.logger,
        { declarationId: found.id, consentId },
        'Registry lookups not started',
      );
      // Then locked, and checked again: a submission meanwhile refuses the request, and the
      // workflow, finding nothing once this rolls back, looks nothing up.
      const declaration = await liveDeclaration(tx, declarationId, { lock: true });
      if (!declaration) return null;
      if (!isEditable(declaration.status)) throw declarationNotDraft('edited');
      await tx.insert(suggestionConsents).values({
        id: consentId,
        declarationId: declaration.id,
        personKey,
        consentedBy: person.subject,
        consentedAt: now,
        textVersion: request.consent.textVersion,
        systems,
      });
      const sets = await tx
        .insert(suggestionSets)
        .values(
          planned.map(({ setId, system }) => ({
            id: setId,
            declarationId: declaration.id,
            personKey,
            source: system,
            consentId,
            requestedAt: now,
          })),
        )
        .returning();
      await this.events.record(
        tx,
        declarationLookupRequested(declaration.tenant, {
          declarationId: declaration.id,
          personKey,
          systems,
          consentId,
          consentedBy: person.subject,
          consentTextVersion: request.consent.textVersion,
        }),
      );
      return sets;
    });
    return notFoundIfInvisible(recorded).map((set) => setView(set, []));
  }

  /**
   * The draft's suggestion sets with their suggestions, oldest request first, narrowed to a person
   * or to the suggestions of a section (a set with suggestions, none of them in the section, is
   * left out; one with none yet stays, so a pending lookup can be polled). Contents are decrypted
   * here, for the declarant.
   */
  async list(
    principal: Principal,
    declarationId: string,
    query: SuggestionsQuery,
  ): Promise<SuggestionSet[]> {
    const person = personOf(principal);
    const { personKey } = query;
    const found = await withPerson(this.db, person, async (tx) => {
      const declaration = await liveDeclaration(tx, declarationId);
      if (!declaration) return null;
      // No person of a household has such a key, so none has sets.
      if (personKey !== undefined && !isPersonKey(personKey)) {
        return { declaration, sets: [], rows: [] };
      }
      const sets = await tx
        .select()
        .from(suggestionSets)
        .where(
          and(
            eq(suggestionSets.declarationId, declaration.id),
            personKey === undefined ? undefined : eq(suggestionSets.personKey, personKey),
          ),
        )
        .orderBy(asc(suggestionSets.requestedAt), asc(suggestionSets.id));
      const rows =
        sets.length === 0
          ? []
          : await tx
              .select()
              .from(suggestions)
              .where(
                inArray(
                  suggestions.setId,
                  sets.map((set) => set.id),
                ),
              )
              .orderBy(asc(suggestions.id));
      return { declaration, sets, rows };
    });
    const { declaration, sets, rows } = notFoundIfInvisible(found);
    const opened = await Promise.all(
      rows.map(async (row) =>
        suggestionView(
          row,
          await this.cipher.open(declaration.tenant, declaration.id, row.id, row),
        ),
      ),
    );
    return sets
      .sort(
        (a, b) =>
          a.requestedAt.getTime() - b.requestedAt.getTime() ||
          // Registries in the order the portal shows them.
          SUGGESTION_SOURCES.indexOf(a.source) - SUGGESTION_SOURCES.indexOf(b.source),
      )
      .flatMap((set) => {
        const own = opened.filter((suggestion) => suggestion.setId === set.id);
        if (query.sectionKey === undefined) return [setView(set, own)];
        const inSection = own.filter((suggestion) => suggestion.sectionKey === query.sectionKey);
        return own.length > 0 && inSection.length === 0 ? [] : [setView(set, inSection)];
      });
  }

  /**
   * Accepts a `new` suggestion (S4): the section read-modify-write of the section save, with
   * `If-Match`, adding the item with the suggestion as its `source` or filling the item it is
   * applied to (`acceptance.ts`), whose source names the registry's verification result only when
   * the item holds what the registry said. In the save's transaction the suggestion becomes
   * `accepted` with the item, re-checked under a row lock, and `declaration.suggestion-accepted.v1`
   * is recorded beside the save's own `declaration.section-saved.v1`. 409 `not-new` when it was
   * decided or superseded already, 409 `draft-version-mismatch` when the draft changed since
   * `If-Match` (428 without it), 400 for fields the item cannot take or a suggestion with no place
   * in declaration.v1, 404 when it is not the caller's.
   */
  async accept(
    principal: Principal,
    declarationId: string,
    suggestionId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<SuggestionAcceptance> {
    const person = personOf(principal);
    const { declaration, row, set } = await this.decidable(person, declarationId, suggestionId);
    const parsed = acceptSuggestionRequestSchema.safeParse(body);
    if (!parsed.success) throw validationProblem(fieldErrors(parsed.error.issues));
    const accepted = { ...parsed.data, overwrite: parsed.data.overwrite === true };
    const offered = await this.cipher.open(declaration.tenant, declaration.id, row.id, row);
    const verificationResultId = row.verificationResultId ?? set.verificationResultId;
    const { source: kind } = set;
    // What an item's `source` can name; IPRS's go into the bio, which has none.
    const source = isItemSourceKind(kind)
      ? {
          kind,
          suggestionId: row.id,
          ...(verificationResultId ? { verificationResultId } : {}),
          ...(set.aiJobId ? { aiJobId: set.aiJobId } : {}),
          at: this.clock.now().toISOString(),
        }
      : null;
    const placement =
      source && kind === 'document' && set.targetSection && isStatementKey(row.sectionKey)
        ? readingPlacementOf(
            {
              sectionKey: row.sectionKey,
              list: set.targetSection,
              itemType: row.itemType,
              fields: offered.fields,
            },
            accepted,
            source,
            uuidv7(),
          )
        : placementOf(
            { ...row, fields: offered.fields, matchKeys: offered.matchKeys },
            accepted,
            source,
            uuidv7(),
          );
    let itemId: string | null = null;
    let decided: SuggestionRow | undefined;
    let saved: { draftVersion: number };
    try {
      saved = await this.drafts.editSection(
        principal,
        declaration.id,
        placement.sectionKey,
        ifMatch,
        (stored) => {
          const applied = placement.apply(stored);
          itemId = applied.itemId;
          return applied.contents;
        },
        async (tx) => {
          ({ row: decided } = await decide(tx, row.id, {
            status: 'accepted',
            acceptedItemId: itemId,
          }));
          await this.events.record(
            tx,
            declarationSuggestionAccepted(declaration.tenant, {
              declarationId: declaration.id,
              suggestionId: row.id,
              setId: row.setId,
              source: set.source,
              sectionKey: placement.sectionKey,
              itemId,
              applied: accepted.applyToItemId !== null,
            }),
          );
        },
      );
    } catch (error) {
      // A suggestion is accepted onto the draft the declarant saw: a stale one conflicts.
      if (error instanceof ProblemException && error.problem.type === 'draft-version-mismatch') {
        throw new ProblemException({ ...error.problem, status: HttpStatus.CONFLICT });
      }
      throw error;
    }
    if (!decided) throw new Error(`Suggestion ${row.id} was not marked accepted`);
    return {
      suggestion: suggestionView(decided, offered),
      itemId,
      etag: etag(saved.draftVersion),
    };
  }

  /**
   * Sets a `new` suggestion aside with the declarant's reason, if they gave one (S5), recording
   * `declaration.suggestion-dismissed.v1` (identifiers only; the reason stays with the
   * suggestion, sealed with the Commission's key). Dismissing it again, or at the same time,
   * changes nothing and answers it as it is; 409 `not-new` when it was accepted or superseded;
   * 404 when it is not the caller's. The draft is untouched.
   */
  async dismiss(
    principal: Principal,
    declarationId: string,
    suggestionId: string,
    body: unknown,
  ): Promise<Suggestion> {
    const person = personOf(principal);
    const { declaration, row, set } = await this.decidable(person, declarationId, suggestionId, {
      dismissed: true,
    });
    const parsed = dismissSuggestionRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw validationProblem(fieldErrors(parsed.error.issues));
    const reason = parsed.data.reason?.trim() ? parsed.data.reason.trim() : null;
    // Sealed before the transaction: the key service is not called with a row lock held.
    const sealed =
      row.status === 'dismissed' || reason === null
        ? null
        : await this.cipher.sealReason(declaration.tenant, declaration.id, row.id, reason);
    const dismissed =
      row.status === 'dismissed'
        ? row
        : await withPerson(this.db, person, async (tx) => {
            const updated = await decide(tx, row.id, {
              status: 'dismissed',
              reasonCiphertext: sealed?.ciphertext ?? null,
              reasonEnvelope: sealed?.envelope ?? null,
            });
            // Another dismissal got there first: it made the change and the event.
            if (!updated.changed) return updated.row;
            await this.events.record(
              tx,
              declarationSuggestionDismissed(declaration.tenant, {
                declarationId: declaration.id,
                suggestionId: row.id,
                setId: row.setId,
                source: set.source,
              }),
            );
            return updated.row;
          });
    return suggestionView(
      dismissed,
      await this.cipher.open(declaration.tenant, declaration.id, dismissed.id, dismissed),
    );
  }

  /**
   * The suggestion on the caller's draft, while the declarant can still decide on it: 404 when
   * either is not theirs, 409 when the declaration is past the draft, 409 `not-new` when it is
   * no longer `new` (a dismissed one passes for a repeated dismissal).
   */
  private async decidable(
    person: PersonContext,
    declarationId: string,
    suggestionId: string,
    { dismissed = false }: { dismissed?: boolean } = {},
  ): Promise<{ declaration: DeclarationRow; row: SuggestionRow; set: SetRow }> {
    if (!isUuid(suggestionId)) notFoundIfInvisible(null);
    const found = await withPerson(this.db, person, async (tx) => {
      const declaration = await liveDeclaration(tx, declarationId);
      if (!declaration) return null;
      const [joined] = await tx
        .select()
        .from(suggestions)
        .innerJoin(suggestionSets, eq(suggestionSets.id, suggestions.setId))
        .where(
          and(eq(suggestions.id, suggestionId), eq(suggestions.declarationId, declaration.id)),
        );
      return joined ? { declaration, row: joined.suggestions, set: joined.suggestion_sets } : null;
    });
    const { declaration, row, set } = notFoundIfInvisible(found);
    if (!isEditable(declaration.status)) throw declarationNotDraft('edited');
    if (row.status !== 'new' && !(dismissed && row.status === 'dismissed')) throw notNew();
    return { declaration, row, set };
  }

  /**
   * The person `personKey` names, if they can be looked up: the declarant always (by the national
   * ID on their person record); a spouse or child must be listed in Household, with a national ID.
   */
  private async checkPerson(
    tx: Transaction,
    declaration: DeclarationRow,
    personKey: string,
  ): Promise<PersonKey> {
    if (isOfficer(personKey)) return personKey;
    const notInHousehold = validationProblem([
      { path: 'personKey', message: 'Not a person of the household' },
    ]);
    if (!isHouseholdPersonKey(personKey)) throw notInHousehold;
    const household = await savedHouseholdPerson(tx, this.sections, declaration, personKey);
    if (!household.listed) throw notInHousehold;
    if (household.nationalId === null) {
      throw ProblemException.fromCode('no-id', {
        detail: 'Add their national ID in Household to check registries for them.',
      });
    }
    return personKey;
  }
}

/**
 * The request, with the declarant's consent checked first: without "I request this check" (and
 * the version of the text they were shown) nothing is recorded and nothing is asked.
 */
function parseRequest(body: unknown): RegistryLookupRequest {
  const consent = isRecord(body) ? body.consent : undefined;
  if (
    !isRecord(consent) ||
    consent.requested !== true ||
    typeof consent.textVersion !== 'string' ||
    consent.textVersion.trim() === ''
  ) {
    throw ProblemException.fromCode('consent-required', {
      detail: 'The declarant must request the check, with the consent text version shown.',
    });
  }
  const parsed = registryLookupRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw validationProblem(fieldErrors(parsed.error.issues));
  }
  // IPRS gives what the bio declares; a household member's birth is not declared, so not looked up.
  if (!isOfficer(parsed.data.personKey) && parsed.data.systems.includes('iprs')) {
    throw validationProblem([
      { path: 'systems', message: 'IPRS is checked only for the declarant' },
    ]);
  }
  return parsed.data;
}

/**
 * In the deciding transaction: the suggestion, locked, becomes `status` if it is still `new`;
 * 409 `not-new` if another request decided it first (or a re-check superseded it), except that a
 * dismissal finding it dismissed already answers it unchanged (dismiss is idempotent by state,
 * ADR-013 §8.13).
 */
async function decide(
  tx: Transaction,
  suggestionId: string,
  decision:
    | { status: 'accepted'; acceptedItemId: string | null }
    | {
        status: 'dismissed';
        reasonCiphertext: Buffer | null;
        reasonEnvelope: StoredEnvelope | null;
      },
): Promise<{ row: SuggestionRow; changed: boolean }> {
  const [current] = await tx
    .select()
    .from(suggestions)
    .where(eq(suggestions.id, suggestionId))
    .for('update');
  if (current?.status === 'dismissed' && decision.status === 'dismissed') {
    return { row: current, changed: false };
  }
  if (current?.status !== 'new') throw notNew();
  const [updated] = await tx
    .update(suggestions)
    .set(decision)
    .where(eq(suggestions.id, suggestionId))
    .returning();
  if (!updated) throw notNew();
  return { row: updated, changed: true };
}

function notNew(): ProblemException {
  return ProblemException.fromCode('not-new', {
    detail: 'This suggestion was accepted, dismissed or replaced by a later check already.',
  });
}

function isItemSourceKind(kind: string): kind is ItemSource['kind'] {
  return (ITEM_SOURCE_KINDS as readonly string[]).includes(kind);
}
