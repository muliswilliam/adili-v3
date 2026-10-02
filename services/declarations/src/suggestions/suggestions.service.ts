import { Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import type { PersonKey } from '@adili/forms';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import { isEditable } from '../declaration/schema.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { isRecord } from '../guards.js';
import { personOf } from '../drafts/access.js';
import { declarationNotDraft, validationProblem } from '../drafts/problems.js';
import { type DeclarationRow, liveDeclaration, sectionIs } from '../drafts/repository.js';
import { declarationSections } from '../drafts/schema.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import { declarationLookupRequested } from './events.js';
import { householdPerson, isHouseholdPersonKey, isOfficer } from './persons.js';
import { RegistryLookupWorkflows } from './registry-lookup-workflows.js';
import {
  type RegistryLookupRequest,
  registryLookupRequestSchema,
  type Suggestion,
  type SuggestionSet,
} from './representation.js';
import { suggestionConsents, suggestions, suggestionSets } from './schema.js';
import { SuggestionCipher } from './suggestion-cipher.js';

/** Registries in the order the portal shows them. */
const REGISTRY_ORDER = ['kra', 'ntsa', 'brs', 'ardhisasa', 'document'];

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

    const recorded = await withPerson(this.db, person, async (tx) => {
      const declaration = await liveDeclaration(tx, declarationId, { lock: true });
      if (!declaration) return null;
      if (!isEditable(declaration.status)) throw declarationNotDraft('edited');
      await this.checkPerson(tx, declaration, request.personKey);
      await tx.insert(suggestionConsents).values({
        id: consentId,
        declarationId: declaration.id,
        personKey: request.personKey as PersonKey,
        consentedBy: person.subject,
        consentedAt: now,
        textVersion: request.consent.textVersion,
        systems,
      });
      const sets = await tx
        .insert(suggestionSets)
        .values(
          systems.map((source) => ({
            id: uuidv7(),
            declarationId: declaration.id,
            personKey: request.personKey as PersonKey,
            source,
            consentId,
            requestedAt: now,
          })),
        )
        .returning();
      await this.events.record(
        tx,
        declarationLookupRequested(declaration.tenant, {
          declarationId: declaration.id,
          personKey: request.personKey,
          systems,
          consentId,
        }),
      );
      return { declaration, sets };
    });
    const { declaration, sets } = notFoundIfInvisible(recorded);

    try {
      await this.workflows.start({
        tenant: declaration.tenant,
        declarationId: declaration.id,
        personId: person.personId,
        subject: person.subject,
        personKey: request.personKey,
        consentId,
        sets: sets.map((set) => ({
          setId: set.id,
          system: set.source as (typeof systems)[number],
        })),
      });
    } catch (error) {
      // Nothing will answer these sets: say so now rather than leave them pending.
      this.logger.warn(
        { err: error, declarationId: declaration.id, consentId },
        'Registry lookups not started',
      );
      await this.markFailed(
        person,
        sets.map((set) => set.id),
      );
      return sets.map((set) => setView({ ...set, status: 'failed' }, []));
    }
    return sets.map((set) => setView(set, []));
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
    const found = await withPerson(this.db, person, async (tx) => {
      const declaration = await liveDeclaration(tx, declarationId);
      if (!declaration) return null;
      const sets = await tx
        .select()
        .from(suggestionSets)
        .where(
          and(
            eq(suggestionSets.declarationId, declaration.id),
            query.personKey === undefined
              ? undefined
              : eq(suggestionSets.personKey, query.personKey as PersonKey),
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
          REGISTRY_ORDER.indexOf(a.source) - REGISTRY_ORDER.indexOf(b.source),
      )
      .flatMap((set) => {
        const own = opened.filter((suggestion) => suggestion.setId === set.id);
        if (query.sectionKey === undefined) return [setView(set, own)];
        const inSection = own.filter((suggestion) => suggestion.sectionKey === query.sectionKey);
        return own.length > 0 && inSection.length === 0 ? [] : [setView(set, inSection)];
      });
  }

  /**
   * The officer can always be looked up (by their roster record); a spouse or child must be
   * listed in Household, with a national ID.
   */
  private async checkPerson(
    tx: Transaction,
    declaration: DeclarationRow,
    personKey: string,
  ): Promise<void> {
    if (isOfficer(personKey)) return;
    const notInHousehold = validationProblem([
      { path: 'personKey', message: 'Not a person of the household' },
    ]);
    if (!isHouseholdPersonKey(personKey)) throw notInHousehold;
    const [section] = await tx
      .select()
      .from(declarationSections)
      .where(sectionIs(declaration.id, 'household'));
    const household = section
      ? householdPerson(await this.sections.open(declaration.tenant, section), personKey)
      : { listed: false as const };
    if (!household.listed) throw notInHousehold;
    if (household.nationalId === null) {
      throw ProblemException.fromCode('no-id', {
        detail: 'Add their national ID in Household to check registries for them.',
      });
    }
  }

  private async markFailed(person: PersonContext, setIds: string[]): Promise<void> {
    try {
      await withPerson(this.db, person, (tx) =>
        tx
          .update(suggestionSets)
          .set({ status: 'failed' })
          .where(and(inArray(suggestionSets.id, setIds), eq(suggestionSets.status, 'pending'))),
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'Unstarted registry lookups not marked failed');
    }
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
    throw validationProblem(
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return parsed.data;
}

type SetRow = typeof suggestionSets.$inferSelect;
type SuggestionRow = typeof suggestions.$inferSelect;

function setView(set: SetRow, own: Suggestion[]): SuggestionSet {
  return {
    id: set.id,
    personKey: set.personKey,
    source: set.source,
    status: set.status,
    requestedAt: set.requestedAt.toISOString(),
    readyAt: set.readyAt?.toISOString() ?? null,
    verificationResultId: set.verificationResultId,
    aiJobId: set.aiJobId,
    suggestions: own,
  };
}

function suggestionView(
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
