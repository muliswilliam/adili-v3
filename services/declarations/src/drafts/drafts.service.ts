import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import {
  ATTESTATION_TEXT,
  type DeclarationSectionKey,
  declarationIssues,
  type PersonKey,
} from '@adili/forms';
import { isDeepStrictEqual } from 'node:util';

import { and, count, desc, eq, inArray, like, max, ne, notInArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import type { Transaction } from '../obligations/apply-page.js';
import { fallbackIssuerCode } from '../obligations/access.js';
import { nairobiDate } from '../obligations/dates.js';
import { commissionRefs, filingObligations } from '../obligations/schema.js';
import { itemIds, keepAttachments } from './attachments.js';
import { assessSections, type DraftSections, type SectionAssessment } from './completeness.js';
import { deriveHeader } from './derive.js';
import {
  declarationAttachmentUnlinked,
  declarationDraftDiscarded,
  declarationDraftStarted,
} from './events.js';
import {
  duplicatePeople,
  householdPeople,
  type NotIncluded,
  planStatements,
  type StatementPerson,
} from './household.js';
import { composeMaterialChanges } from './material-changes.js';
import type {
  Declaration,
  DeclarationListItem,
  DeclarationSummary,
  SectionEnvelope,
  SectionSaveResult,
} from './representation.js';
import { type SealedSection, SectionCipher, type StoredSection } from './section-cipher.js';
import {
  applyLockedFields,
  displayName,
  emptyHousehold,
  emptyOther,
  emptyStatement,
  isSectionKey,
  nilConflicts,
  prefillBio,
  type SectionContents,
  sectionMetadata,
  sectionRank,
  shapeErrors,
  type StatementFrame,
  statementPersonKey,
} from './sections.js';
import {
  assembleDocument,
  blockingIssues,
  cannotSubmitReason,
  notStartedIssues,
} from './summary.js';
import {
  declarationAttachments,
  declarationSections,
  declarations,
  type SectionCompleteness,
  type SectionMetadata,
  type StoredEnvelope,
} from './schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Obligations a declaration can no longer be started for. */
const CLOSED_OBLIGATION_STATUSES = new Set(['filed', 'cancelled']);

type DeclarationRow = typeof declarations.$inferSelect;
type SectionRow = typeof declarationSections.$inferSelect;

/** Sections of a draft without their contents, as the header lists them. */
type SectionSummaryRow = Omit<SectionRow, 'ciphertext' | 'envelope'>;

/**
 * Declaration drafts (spec 05): start from an obligation, read the draft, read and save its
 * capture sections, summarise it, discard it, list the declarant's own. Every route is the declarant's own by the `person_id` claim, under
 * person-scoped row-level security; anyone else, staff included, gets 404. Section contents are
 * encrypted with the Commission's key before they reach the database; clear metadata is derived
 * here on save, never taken from the client. Each save is one transaction that bumps the draft
 * version only if it still is the version the client read (`If-Match`).
 */
@Injectable()
export class DraftsService {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly directory: DirectoryClient,
    private readonly sections: SectionCipher,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * The declarant's draft for the obligation: the existing live one (`created: false`), or a new
   * one derived from the obligation with bio pre-filled from the roster record. 409 when the
   * obligation is filed or cancelled, even while a draft of it is live.
   */
  async start(
    principal: Principal,
    obligationId: string,
  ): Promise<{ created: boolean; declaration: Declaration }> {
    const person = personOf(principal);
    if (!UUID.test(obligationId)) notFoundIfInvisible(null);
    const found = await withPerson(this.db, person, async (tx) => {
      const [obligation] = await tx
        .select({
          id: filingObligations.id,
          tenant: filingObligations.tenant,
          rosterRecordId: filingObligations.rosterRecordId,
          type: filingObligations.type,
          statementDate: filingObligations.statementDate,
          status: filingObligations.status,
        })
        .from(filingObligations)
        .where(
          and(
            eq(filingObligations.id, obligationId),
            eq(filingObligations.personId, person.personId),
          ),
        )
        .limit(1);
      if (!obligation) return null;
      const existing = await liveDeclarationOf(tx, obligationId);
      const [previous] = await tx
        .select({ statementDate: max(declarations.statementDate) })
        .from(declarations)
        .where(
          and(eq(declarations.personId, person.personId), eq(declarations.status, 'submitted')),
        );
      return { obligation, existing, previousStatementDate: previous?.statementDate ?? null };
    });
    const { obligation, existing, previousStatementDate } = notFoundIfInvisible(found);
    // A filed or cancelled obligation is closed, whatever draft of it is still live.
    if (CLOSED_OBLIGATION_STATUSES.has(obligation.status)) {
      throw new ProblemException({
        type: 'obligation-closed',
        title: 'Obligation filed or cancelled',
        status: HttpStatus.CONFLICT,
        detail: `No declaration can be started for a ${obligation.status} obligation.`,
      });
    }
    if (existing) return { created: false, declaration: await this.read(person, existing.id) };

    const record = await this.rosterRecord(obligation.tenant, obligation.rosterRecordId);
    const header = deriveHeader(
      { type: obligation.type, statementDate: obligation.statementDate },
      {
        previousStatementDate: previousStatementDate ?? undefined,
        appointmentDate: record.appointmentDate ?? undefined,
      },
    );
    const id = uuidv7();
    const bio = prefillBio({
      tenant: obligation.tenant,
      fullName: record.fullName,
      personnelFileNumber: record.personnelFileNumber,
      designation: record.designation,
      employer: record.reportingEntity?.name ?? null,
    });
    const initial: [DeclarationSectionKey, SectionContents, SectionMetadata][] = [
      ['bio', bio.contents, { lockedFields: bio.lockedFields }],
      ['household', emptyHousehold(), {}],
      [
        'statement:officer',
        emptyStatement({
          personKey: 'officer',
          personName: bio.contents.name as Record<string, unknown>,
          statementDate: header.statementDate,
          incomePeriod: { from: header.incomePeriod.from, to: header.incomePeriod.to },
        }),
        {},
      ],
      ['other', emptyOther(), {}],
    ];
    const sealed = await Promise.all(
      initial.map(async ([key, contents, metadata]) => ({
        key,
        metadata: { ...sectionMetadata(key, contents), ...metadata },
        ...(await this.sections.seal(obligation.tenant, id, key, contents)),
      })),
    );

    try {
      await withPerson(this.db, person, async (tx) => {
        await tx.insert(declarations).values({
          id,
          tenant: obligation.tenant,
          personId: person.personId,
          obligationId,
          rosterRecordId: obligation.rosterRecordId,
          type: header.type,
          statementDate: header.statementDate,
          incomePeriodFrom: header.incomePeriod.from,
          incomePeriodTo: header.incomePeriod.to,
          previousStatementDateSource: header.incomePeriod.fromSource,
        });
        await tx.insert(declarationSections).values(
          sealed.map((section) => ({
            declarationId: id,
            sectionKey: section.key,
            ciphertext: section.ciphertext,
            envelope: section.envelope,
            metadata: section.metadata,
            savedVersion: 1,
          })),
        );
        await this.events.record(
          tx,
          declarationDraftStarted(obligation.tenant, {
            declarationId: id,
            obligationId,
            type: header.type,
          }),
        );
      });
    } catch (error) {
      // Another start for the obligation won the race: theirs is the draft.
      if (violatedUniqueConstraint(error) !== 'declarations_live_obligation_key') throw error;
      const winner = await withPerson(this.db, person, (tx) => liveDeclarationOf(tx, obligationId));
      if (!winner) throw error;
      return { created: false, declaration: await this.read(person, winner.id) };
    }
    await Promise.all(
      initial.map(([key, contents]) =>
        this.sections.cache({ declarationId: id, sectionKey: key, savedVersion: 1 }, contents),
      ),
    );
    return { created: true, declaration: await this.read(person, id) };
  }

  /** The draft's header and its sections' completeness, without contents. */
  async get(principal: Principal, declarationId: string): Promise<Declaration> {
    return this.read(personOf(principal), declarationId);
  }

  /**
   * The draft as it would be declared (S11, S12): the `declaration.v1` document assembled from the
   * live sections only (an archived statement never reaches it or paragraph 9), whether it
   * validates, what blocks submission by section and field, and the solemn declaration. Nothing
   * can be submitted in this slice; the reason says whether the statement date has come.
   */
  async summary(principal: Principal, declarationId: string): Promise<DeclarationSummary> {
    const person = personOf(principal);
    const found = await withPerson(this.db, person, async (tx) => {
      const declaration = await liveDeclaration(tx, declarationId);
      if (!declaration) return null;
      return { declaration, sections: await liveSections(tx, declaration.id) };
    });
    const { declaration, sections } = notFoundIfInvisible(found);
    const live = await Promise.all(
      sections.map(async (section) => ({
        key: section.sectionKey as DeclarationSectionKey,
        contents: await this.open(declaration, section),
      })),
    );
    const document = assembleDocument(
      {
        type: declaration.type,
        statementDate: declaration.statementDate,
        incomePeriod: {
          from: declaration.incomePeriodFrom,
          to: declaration.incomePeriodTo,
          fromSource: declaration.previousStatementDateSource,
        },
      },
      live,
    );

    // Each section as its own view reports it (rules and schema), with paragraph 9 as composed.
    const statements = new Map<PersonKey, SectionContents>();
    const byKey = new Map<string, SectionContents>();
    for (const { key, contents } of live) {
      const personKey = statementPersonKey(key);
      if (personKey) statements.set(personKey, contents);
      else byKey.set(key, contents);
    }
    const assessed = assessSections({
      bio: byKey.get('bio'),
      household: byKey.get('household'),
      statements,
      other: document.otherInformation,
    });
    const validated = declarationIssues(document);
    // A section never saved blocks, and the document is not valid, until the declarant saves it.
    const notStarted = notStartedIssues(
      sections.map((section) => ({
        key: section.sectionKey as DeclarationSectionKey,
        completeness: section.completeness,
      })),
    );

    return {
      declaration: await this.read(person, declaration.id),
      document,
      valid:
        notStarted.length === 0 &&
        validated.issues.length === 0 &&
        validated.declaration.length === 0,
      blocking: blockingIssues(
        notStarted,
        [...assessed.values()].flatMap((assessment) => assessment.issues),
        validated.issues,
      ),
      canSubmit: false,
      cannotSubmitReason: cannotSubmitReason(
        nairobiDate(this.clock.now()),
        declaration.statementDate,
      ),
      attestationText: ATTESTATION_TEXT,
    };
  }

  /**
   * Discards the draft (S15): its sections and attachment rows are deleted, with an unlink event
   * per attachment (the files are left to the documents orphan sweep), and the declaration is
   * marked `discarded`. The obligation is untouched, so a new start makes a fresh draft. 404 when
   * the draft is not the caller's or already discarded, 409 when it is no longer a draft.
   */
  async discard(principal: Principal, declarationId: string): Promise<void> {
    const person = personOf(principal);
    if (!UUID.test(declarationId)) notFoundIfInvisible(null);
    await withPerson(this.db, person, async (tx) => {
      const [found] = await tx
        .select()
        .from(declarations)
        .where(and(eq(declarations.id, declarationId), ne(declarations.status, 'discarded')))
        .limit(1)
        .for('update');
      const declaration = notFoundIfInvisible(found);
      if (declaration.status !== 'draft') {
        throw new ProblemException({
          type: 'declaration-not-draft',
          title: 'Not a draft',
          status: HttpStatus.CONFLICT,
          detail: 'Only a draft declaration can be discarded.',
        });
      }
      const unlinked = await tx
        .delete(declarationAttachments)
        .where(eq(declarationAttachments.declarationId, declarationId))
        .returning({ uploadId: declarationAttachments.uploadId });
      await tx
        .delete(declarationSections)
        .where(eq(declarationSections.declarationId, declarationId));
      await tx
        .update(declarations)
        .set({ status: 'discarded' })
        .where(eq(declarations.id, declarationId));
      for (const { uploadId } of unlinked) {
        await this.events.record(
          tx,
          declarationAttachmentUnlinked(declaration.tenant, { declarationId, uploadId }),
        );
      }
      await this.events.record(
        tx,
        declarationDraftDiscarded(declaration.tenant, { declarationId }),
      );
    });
  }

  /**
   * The declarant's live declarations (S16), last updated first, each with how much is complete:
   * complete sections out of the live ones (archived statements left out).
   */
  async mine(principal: Principal): Promise<DeclarationListItem[]> {
    const person = personOf(principal);
    const { rows, completeness, commissions } = await withPerson(this.db, person, async (tx) => {
      const rows = await tx
        .select()
        .from(declarations)
        .where(
          and(eq(declarations.personId, person.personId), ne(declarations.status, 'discarded')),
        )
        .orderBy(desc(declarations.updatedAt), desc(declarations.id));
      if (rows.length === 0) return { rows, completeness: [], commissions: [] };
      const completeness = await tx
        .select({
          declarationId: declarationSections.declarationId,
          completeness: declarationSections.completeness,
          sections: count(),
        })
        .from(declarationSections)
        .where(
          and(
            inArray(
              declarationSections.declarationId,
              rows.map((row) => row.id),
            ),
            ne(declarationSections.completeness, 'archived'),
          ),
        )
        .groupBy(declarationSections.declarationId, declarationSections.completeness);
      const commissions = await tx
        .select({
          slug: commissionRefs.slug,
          issuerCode: commissionRefs.issuerCode,
          name: commissionRefs.name,
        })
        .from(commissionRefs)
        .where(
          inArray(
            commissionRefs.slug,
            rows.map((row) => row.tenant),
          ),
        );
      return { rows, completeness, commissions };
    });
    const bySlug = new Map(commissions.map((commission) => [commission.slug, commission]));
    return rows.map((row) => {
      const counted = completeness.filter((group) => group.declarationId === row.id);
      const live = counted.reduce((sum, group) => sum + group.sections, 0);
      const complete = counted
        .filter((group) => group.completeness === 'complete')
        .reduce((sum, group) => sum + group.sections, 0);
      const commission = bySlug.get(row.tenant);
      const issuerCode = commission?.issuerCode ?? fallbackIssuerCode(row.tenant);
      return {
        id: row.id,
        obligationId: row.obligationId,
        commission: { slug: row.tenant, issuerCode, name: commission?.name ?? issuerCode },
        type: row.type,
        statementDate: row.statementDate,
        status: row.status,
        completenessPercent: live === 0 ? 0 : Math.floor((complete * 100) / live),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  /** One section's contents, decrypted for the declarant, with what it still needs. */
  async getSection(
    principal: Principal,
    declarationId: string,
    sectionKey: string,
  ): Promise<SectionEnvelope> {
    const person = personOf(principal);
    const key = sectionKeyOf(sectionKey);
    const state = notFoundIfInvisible(
      await withPerson(this.db, person, (tx) => readSection(tx, declarationId, key)),
    );
    const opened = await this.open(state.declaration, state.section);
    // Paragraph 9's material changes follow the items as they are now, not as `other` was saved.
    const contents =
      key === 'other'
        ? { ...opened, materialChanges: await this.materialChanges(person, state.declaration) }
        : opened;
    const issues =
      state.section.completeness === 'not-started' || state.section.completeness === 'archived'
        ? []
        : (await this.assess(state.declaration, key, contents, state.sibling)).section.issues;
    return {
      key,
      completeness: state.section.completeness,
      contents,
      issues,
      ...(key === 'household' && { notIncluded: notIncludedOf(state.section.metadata) }),
      draftVersion: state.declaration.draftVersion,
    };
  }

  /**
   * Saves one section: `ifMatch` must be the draft version the client read (428 without it, 412
   * when another save came first). The body must be well formed for the section; missing fields
   * are completeness, not errors. Locked bio fields cannot change (400 `identity-locked-field`);
   * a statement's person and dates are the service's. One transaction bumps the draft version
   * and stores the encrypted section with its clear metadata.
   */
  async saveSection(
    principal: Principal,
    declarationId: string,
    sectionKey: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<SectionSaveResult> {
    const person = personOf(principal);
    const key = sectionKeyOf(sectionKey);
    const expected = expectedVersion(ifMatch);
    const state = notFoundIfInvisible(
      await withPerson(this.db, person, (tx) => readSection(tx, declarationId, key)),
    );
    const { declaration, section } = state;
    if (declaration.status !== 'draft') {
      throw new ProblemException({
        type: 'declaration-not-draft',
        title: 'Not a draft',
        status: HttpStatus.CONFLICT,
        detail: 'Only a draft declaration can be edited.',
      });
    }
    if (declaration.draftVersion !== expected) throw versionMismatch();
    if (section.metadata.archived === true) {
      throw new ProblemException({
        type: 'section-archived',
        title: 'Section archived',
        status: HttpStatus.CONFLICT,
        detail: 'This person was removed from the household; add them back to edit it.',
      });
    }
    if (!isRecord(body)) throw validationProblem([{ path: '', message: 'Expected an object' }]);
    const errors = shapeErrors(key, body);
    if (errors.length > 0) throw validationProblem(errors);
    if (statementPersonKey(key)) {
      const conflicts = nilConflicts(body);
      if (conflicts.length > 0) {
        throw new ProblemException({
          type: 'nil-conflicts-with-items',
          title: 'Nil conflicts with items',
          status: HttpStatus.BAD_REQUEST,
          detail: 'A category declared as having nothing to declare cannot list items.',
          errors: conflicts,
        });
      }
    }

    const stored = await this.open(declaration, section);
    const prepared = await this.prepare(person, declaration, key, body, stored, section.metadata);
    const household =
      key === 'household' ? householdPeople(prepared, declaration.statementDate) : null;
    const contents = household?.contents ?? prepared;
    if (household) {
      const duplicates = duplicatePeople(contents);
      if (duplicates.length > 0) throw validationProblem(duplicates);
    }
    const assessment = await this.assess(declaration, key, contents, state.sibling);
    const metadata: SectionMetadata = {
      ...section.metadata,
      ...sectionMetadata(key, contents),
      ...(household && { notIncluded: household.notIncluded }),
    };
    const sealed = await this.sections.seal(declaration.tenant, declaration.id, key, contents);
    // Saved at the version the conditional bump below produces, or not at all.
    const savedVersion = expected + 1;
    const statements = household
      ? await this.statementChanges(person, declaration, household.statements, savedVersion)
      : [];

    const draftVersion = await withPerson(this.db, person, async (tx) => {
      const [bumped] = await tx
        .update(declarations)
        .set({ draftVersion: sql`${declarations.draftVersion} + 1`, lastSection: key })
        .where(
          and(
            eq(declarations.id, declaration.id),
            eq(declarations.draftVersion, expected),
            eq(declarations.status, 'draft'),
          ),
        )
        .returning({ draftVersion: declarations.draftVersion });
      if (!bumped) throw versionMismatch();
      const now = this.clock.now();
      await tx
        .update(declarationSections)
        .set({
          ciphertext: sealed.ciphertext,
          envelope: sealed.envelope,
          completeness: assessment.section.completeness,
          metadata,
          savedVersion: bumped.draftVersion,
          updatedAt: now,
        })
        .where(sectionIs(declaration.id, key));
      // Bio and household are assessed together (marital status against spouses): a save of
      // one can change the other's completeness, once the other has been saved.
      const sibling = state.sibling;
      if (sibling && assessment.sibling && sibling.completeness !== 'not-started') {
        await tx
          .update(declarationSections)
          .set({ completeness: assessment.sibling.completeness })
          .where(sectionIs(declaration.id, sibling.sectionKey));
      }
      await writeStatementChanges(tx, declaration.id, statements, now);
      if (statementPersonKey(key)) await this.unlinkRemovedItems(tx, declaration, key, contents);
      return bumped.draftVersion;
    });
    await this.sections.cache(
      { declarationId: declaration.id, sectionKey: key, savedVersion: draftVersion },
      contents,
    );
    await Promise.all(
      statements.flatMap((change) =>
        change.contents
          ? [
              this.sections.cache(
                { declarationId: declaration.id, sectionKey: change.key, savedVersion },
                change.contents,
              ),
            ]
          : [],
      ),
    );
    return {
      key,
      completeness: assessment.section.completeness,
      draftVersion,
      issues: assessment.section.issues,
      ...(household && { notIncluded: household.notIncluded }),
      sectionsChanged: statements.flatMap((change) =>
        change.action ? [{ key: change.key, action: change.action }] : [],
      ),
    };
  }

  /**
   * What a household save does to the financial statements (S5): an empty statement for each
   * person new to it, the statement of each person back in it restored, the statement of each
   * person gone from it (or a child no longer under eighteen) archived, and the name on each live
   * statement kept in step with the household. Nothing is deleted before discard. Sealed ahead
   * of the save's transaction, at the version it will write.
   */
  private async statementChanges(
    person: PersonContext,
    declaration: DeclarationRow,
    wanted: StatementPerson[],
    savedVersion: number,
  ): Promise<StatementChange[]> {
    const rows = await withPerson(this.db, person, (tx) =>
      tx
        .select()
        .from(declarationSections)
        .where(
          and(
            eq(declarationSections.declarationId, declaration.id),
            like(declarationSections.sectionKey, 'statement:%'),
          ),
        ),
    );
    const byKey = new Map(rows.map((row) => [row.sectionKey, row]));
    const plan = planStatements(
      wanted,
      rows.map((row) => ({
        personKey: statementPersonKey(row.sectionKey as DeclarationSectionKey) ?? 'officer',
        archived: row.metadata.archived === true,
      })),
    );
    const frame = (who: StatementPerson) => ({
      personKey: who.personKey,
      personName: who.personName,
      statementDate: declaration.statementDate,
      incomePeriod: { from: declaration.incomePeriodFrom, to: declaration.incomePeriodTo },
    });
    const seal = async (
      key: DeclarationSectionKey,
      contents: SectionContents,
    ): Promise<SealedSection & { contents: SectionContents }> => ({
      contents,
      ...(await this.sections.seal(declaration.tenant, declaration.id, key, contents)),
    });

    const created = plan.create.map(async (who): Promise<StatementChange> => {
      const key = `statement:${who.personKey}` as const;
      const contents = emptyStatement(frame(who) as StatementFrame);
      return {
        key,
        action: 'created',
        insert: true,
        completeness: 'not-started',
        metadata: sectionMetadata(key, contents),
        savedVersion,
        ...(await seal(key, contents)),
      };
    });
    const renamed = [...plan.restore, ...plan.keep].map(
      async (who): Promise<StatementChange | null> => {
        const key = `statement:${who.personKey}` as const;
        const row = byKey.get(key);
        if (!row) return null;
        const restoring = row.metadata.archived === true;
        const stored = await this.open(declaration, row);
        const sameName = isDeepStrictEqual(stored.personName, who.personName);
        if (!restoring && sameName) return null;
        const contents = sameName ? stored : { ...stored, ...frame(who) };
        const metadata = { ...row.metadata };
        delete metadata.archived;
        return {
          key,
          ...(restoring && { action: 'restored' as const }),
          insert: false,
          // A statement never saved stays not started; one saved is assessed again.
          completeness:
            row.updatedAt === null ? 'not-started' : statementCompleteness(who.personKey, contents),
          metadata,
          ...(sameName ? {} : { savedVersion, ...(await seal(key, contents)) }),
        };
      },
    );
    const archived = plan.archive.map((personKey): StatementChange => {
      const key = `statement:${personKey}` as const;
      return {
        key,
        action: 'archived',
        insert: false,
        completeness: 'archived',
        metadata: { ...byKey.get(key)?.metadata, archived: true },
      };
    });
    const changes = await Promise.all([...created, ...renamed]);
    return [...changes.filter((change) => change !== null), ...archived];
  }

  /**
   * The contents to store for a well-formed body: the service's own fields enforced. Household
   * rules (statements created and archived) plug in here per section. Paragraph 9's material
   * changes are the service's: composed from the items, never taken from the body.
   */
  private async prepare(
    person: PersonContext,
    declaration: DeclarationRow,
    key: DeclarationSectionKey,
    body: SectionContents,
    stored: SectionContents,
    metadata: SectionMetadata,
  ): Promise<SectionContents> {
    if (key === 'other') {
      return { ...body, materialChanges: await this.materialChanges(person, declaration) };
    }
    if (key === 'bio') {
      const { contents, changed } = applyLockedFields(body, stored, metadata.lockedFields ?? []);
      if (changed.length > 0) {
        throw new ProblemException({
          type: 'identity-locked-field',
          title: 'Locked field changed',
          status: HttpStatus.BAD_REQUEST,
          detail:
            "Names, employer, designation and Commission come from the Commission's roster and cannot be changed here.",
          errors: changed.map((pointer) => ({
            path: pointer.slice(1).replaceAll('/', '.'),
            message: 'Comes from the roster; ask your Commission to correct it',
          })),
        });
      }
      return contents;
    }
    const personKey = statementPersonKey(key);
    if (personKey) {
      return {
        // Attachment references are the service's: only link and unlink change them.
        ...keepAttachments(body, stored),
        personKey,
        personName: stored.personName,
        statementDate: declaration.statementDate,
        incomePeriod: { from: declaration.incomePeriodFrom, to: declaration.incomePeriodTo },
      };
    }
    return body;
  }

  /**
   * In a statement save's transaction: the attachments of items the save removed are unlinked,
   * each with its event, as an unlink would (the references went with the items).
   */
  private async unlinkRemovedItems(
    tx: Transaction,
    declaration: DeclarationRow,
    key: DeclarationSectionKey,
    contents: SectionContents,
  ): Promise<void> {
    const kept = itemIds(contents).filter((id) => UUID.test(id));
    const unlinked = await tx
      .delete(declarationAttachments)
      .where(
        and(
          eq(declarationAttachments.declarationId, declaration.id),
          eq(declarationAttachments.sectionKey, key),
          ...(kept.length > 0 ? [notInArray(declarationAttachments.itemId, kept)] : []),
        ),
      )
      .returning({ uploadId: declarationAttachments.uploadId });
    for (const { uploadId } of unlinked) {
      await this.events.record(
        tx,
        declarationAttachmentUnlinked(declaration.tenant, {
          declarationId: declaration.id,
          uploadId,
        }),
      );
    }
  }

  /** Completeness of a section, and for bio and household of the other one too. */
  private async assess(
    declaration: DeclarationRow,
    key: DeclarationSectionKey,
    contents: SectionContents,
    sibling: StoredSection | null,
  ): Promise<{ section: SectionAssessment; sibling?: SectionAssessment }> {
    const personKey = statementPersonKey(key);
    let draft: DraftSections;
    if (key === 'bio' || key === 'household') {
      const other = sibling ? await this.open(declaration, sibling) : undefined;
      draft =
        key === 'bio' ? { bio: contents, household: other } : { bio: other, household: contents };
    } else if (personKey) {
      draft = {
        bio: undefined,
        household: undefined,
        statements: new Map([[personKey, contents]]),
      };
    } else {
      draft = { bio: undefined, household: undefined, other: contents };
    }
    const assessed = assessSections(draft);
    const section = assessed.get(key) ?? { completeness: 'incomplete', issues: [] };
    const siblingKey = key === 'bio' ? 'household' : key === 'household' ? 'bio' : undefined;
    return siblingKey ? { section, sibling: assessed.get(siblingKey) } : { section };
  }

  /**
   * Paragraph 9's material changes as the draft stands: the marital-status change from bio and
   * every flagged item of the live (not archived) statements, in First Schedule order.
   */
  private async materialChanges(person: PersonContext, declaration: DeclarationRow) {
    const rows = await withPerson(this.db, person, (tx) => liveSections(tx, declaration.id));
    let bio: SectionContents | undefined;
    const statements: [PersonKey, SectionContents][] = [];
    for (const row of rows) {
      const personKey = statementPersonKey(row.sectionKey as DeclarationSectionKey);
      if (!personKey && row.sectionKey !== 'bio') continue;
      const contents = await this.open(declaration, row);
      if (personKey) statements.push([personKey, contents]);
      else bio = contents;
    }
    return composeMaterialChanges({ bio, statements });
  }

  private open(
    declaration: DeclarationRow,
    section: Pick<
      SectionRow,
      'declarationId' | 'sectionKey' | 'savedVersion' | 'ciphertext' | 'envelope'
    >,
  ): Promise<SectionContents> {
    return this.sections.open(declaration.tenant, section);
  }

  private async read(person: PersonContext, declarationId: string): Promise<Declaration> {
    const found = await withPerson(this.db, person, async (tx) => {
      const declaration = await liveDeclaration(tx, declarationId);
      if (!declaration) return null;
      const [commission] = await tx
        .select({ issuerCode: commissionRefs.issuerCode, name: commissionRefs.name })
        .from(commissionRefs)
        .where(eq(commissionRefs.slug, declaration.tenant))
        .limit(1);
      const sections = await tx
        .select({
          declarationId: declarationSections.declarationId,
          sectionKey: declarationSections.sectionKey,
          completeness: declarationSections.completeness,
          metadata: declarationSections.metadata,
          savedVersion: declarationSections.savedVersion,
          createdAt: declarationSections.createdAt,
          updatedAt: declarationSections.updatedAt,
        })
        .from(declarationSections)
        .where(eq(declarationSections.declarationId, declarationId));
      // Names of whose statements they are live in bio and household, encrypted; an archived
      // statement's person is no longer in the household, so its own copy of the name is used.
      const named = await tx
        .select()
        .from(declarationSections)
        .where(
          and(
            eq(declarationSections.declarationId, declarationId),
            sql`(${declarationSections.sectionKey} in ('bio', 'household') or ${declarationSections.completeness} = 'archived')`,
          ),
        );
      return { declaration, commission, sections, named };
    });
    const { declaration, commission, sections, named } = notFoundIfInvisible(found);
    const names = await this.personNames(declaration, named);
    const issuerCode = commission?.issuerCode ?? fallbackIssuerCode(declaration.tenant);
    return {
      id: declaration.id,
      obligationId: declaration.obligationId,
      commission: { slug: declaration.tenant, issuerCode, name: commission?.name ?? issuerCode },
      type: declaration.type,
      statementDate: declaration.statementDate,
      incomePeriod: {
        from: declaration.incomePeriodFrom,
        to: declaration.incomePeriodTo,
        fromSource: declaration.previousStatementDateSource,
      },
      status: declaration.status,
      schemaVersion: 'declaration.v1',
      draftVersion: declaration.draftVersion,
      sections: inScheduleOrder(sections).map((section) => {
        const personKey = statementPersonKey(section.sectionKey as DeclarationSectionKey);
        return {
          key: section.sectionKey,
          completeness: section.completeness,
          updatedAt: section.updatedAt?.toISOString() ?? null,
          personName: personKey ? (names.get(personKey) ?? null) : null,
          ...(section.metadata.counts ? { counts: section.metadata.counts } : {}),
        };
      }),
      lastSection: declaration.lastSection,
      createdAt: declaration.createdAt.toISOString(),
      updatedAt: declaration.updatedAt.toISOString(),
    };
  }

  /**
   * Display names by person key: the officer from bio, spouses and children from household, and
   * people removed from the household from their archived statements.
   */
  private async personNames(
    declaration: DeclarationRow,
    named: SectionRow[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const archived: SectionRow[] = [];
    for (const section of named) {
      if (section.completeness === 'archived') {
        archived.push(section);
        continue;
      }
      const contents = await this.open(declaration, section);
      if (section.sectionKey === 'bio') {
        const name = displayName(contents.name);
        if (name) names.set('officer', name);
        continue;
      }
      for (const [kind, list] of [
        ['spouse', contents.spouses],
        ['child', contents.children],
      ] as const) {
        const items = isRecord(list) && Array.isArray(list.items) ? list.items : [];
        for (const item of items) {
          if (!isRecord(item) || typeof item.id !== 'string') continue;
          const name = displayName(item.name);
          if (name) names.set(`${kind}:${item.id}`, name);
        }
      }
    }
    for (const section of archived) {
      const personKey = statementPersonKey(section.sectionKey as DeclarationSectionKey);
      if (!personKey || names.has(personKey)) continue;
      const name = displayName((await this.open(declaration, section)).personName);
      if (name) names.set(personKey, name);
    }
    return names;
  }

  private async rosterRecord(tenant: string, rosterRecordId: string) {
    try {
      const record = await this.directory.getRosterRecord(tenant, rosterRecordId);
      if (!record) throw new DirectoryUnavailable('The roster record of the obligation is missing');
      return record;
    } catch (error) {
      if (!(error instanceof DirectoryUnavailable)) throw error;
      throw new ProblemException({
        type: 'directory-unavailable',
        title: 'Roster unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The roster record could not be read to pre-fill the declaration. Try again.',
      });
    }
  }
}

export function personOf(principal: Principal): PersonContext {
  return {
    personId: notFoundIfInvisible(principal.personId),
    subject: principal.subject,
  };
}

function sectionKeyOf(value: string): DeclarationSectionKey {
  return isSectionKey(value) ? value : notFoundIfInvisible<DeclarationSectionKey>(null);
}

/** The draft version in `If-Match` (`"3"`, `W/"3"` or `3`); 428 without one. */
function expectedVersion(ifMatch: string | undefined): number {
  if (ifMatch === undefined || ifMatch.trim() === '') {
    throw new ProblemException({
      type: 'if-match-required',
      title: 'If-Match required',
      status: HttpStatus.PRECONDITION_REQUIRED,
      detail: 'Send the draft version you read (its ETag) as If-Match.',
    });
  }
  const match = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(ifMatch);
  if (!match?.[1]) throw versionMismatch();
  return Number(match[1]);
}

function versionMismatch(): ProblemException {
  return new ProblemException({
    type: 'draft-version-mismatch',
    title: 'Draft changed elsewhere',
    status: HttpStatus.PRECONDITION_FAILED,
    detail: 'The draft was saved from somewhere else since you read it. Reload to continue.',
  });
}

export function validationProblem(errors: { path: string; message: string }[]): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    errors,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The household's children who get no statement, as stored in its clear metadata. */
function notIncludedOf(metadata: SectionMetadata): NotIncluded[] {
  return (metadata.notIncluded ?? []) as NotIncluded[];
}

/** A statement section a household save creates, restores, renames or archives. */
interface StatementChange {
  key: DeclarationSectionKey;
  /** As reported in `sectionsChanged`; none for a rename only. */
  action?: 'created' | 'restored' | 'archived';
  insert: boolean;
  completeness: SectionCompleteness;
  metadata: SectionMetadata;
  /** New contents, when they change: sealed, and to cache at `savedVersion`. */
  contents?: SectionContents;
  ciphertext?: Buffer;
  envelope?: StoredEnvelope;
  savedVersion?: number;
}

async function writeStatementChanges(
  tx: Transaction,
  declarationId: string,
  changes: readonly StatementChange[],
  now: Date,
): Promise<void> {
  // Statements are listed by creation within a kind: a millisecond apart, they keep the order the
  // household lists the people in.
  const createdAt = now.getTime();
  let created = 0;
  for (const change of changes) {
    const { ciphertext, envelope, savedVersion } = change;
    const sealed =
      ciphertext && envelope && savedVersion !== undefined
        ? { ciphertext, envelope, savedVersion }
        : undefined;
    if (change.insert) {
      if (!sealed) throw new Error('A new statement must be sealed');
      await tx.insert(declarationSections).values({
        declarationId,
        sectionKey: change.key,
        completeness: change.completeness,
        metadata: change.metadata,
        createdAt: new Date(createdAt + created++),
        ...sealed,
      });
      continue;
    }
    await tx
      .update(declarationSections)
      .set({ completeness: change.completeness, metadata: change.metadata, ...sealed })
      .where(sectionIs(declarationId, change.key));
  }
}

/** A statement's completeness on its own (statements are assessed one by one). */
function statementCompleteness(
  personKey: PersonKey,
  contents: SectionContents,
): 'complete' | 'incomplete' {
  const assessed = assessSections({
    bio: undefined,
    household: undefined,
    statements: new Map([[personKey, contents]]),
  });
  return assessed.get(`statement:${personKey}`)?.completeness ?? 'incomplete';
}

/**
 * The draft's live sections: every section but the statements archived by household edits. The
 * one place archived statements are left out, for completeness and the summary; they stay stored
 * (and listed on the draft as `archived`) until the draft is discarded.
 */
export async function liveSections(tx: Transaction, declarationId: string): Promise<SectionRow[]> {
  const rows = await tx
    .select()
    .from(declarationSections)
    .where(
      and(
        eq(declarationSections.declarationId, declarationId),
        ne(declarationSections.completeness, 'archived'),
      ),
    );
  return inScheduleOrder(rows);
}

export function sectionIs(declarationId: string, sectionKey: string) {
  return and(
    eq(declarationSections.declarationId, declarationId),
    eq(declarationSections.sectionKey, sectionKey),
  );
}

async function liveDeclaration(
  tx: Transaction,
  declarationId: string,
): Promise<DeclarationRow | null> {
  if (!UUID.test(declarationId)) return null;
  const [row] = await tx
    .select()
    .from(declarations)
    .where(and(eq(declarations.id, declarationId), ne(declarations.status, 'discarded')))
    .limit(1);
  return row ?? null;
}

async function liveDeclarationOf(
  tx: Transaction,
  obligationId: string,
): Promise<DeclarationRow | null> {
  const [row] = await tx
    .select()
    .from(declarations)
    .where(and(eq(declarations.obligationId, obligationId), ne(declarations.status, 'discarded')))
    .limit(1);
  return row ?? null;
}

/**
 * A live declaration's section with its contents, and for bio and household the other of the
 * two (they are assessed together). Null when the caller cannot see it or it does not exist.
 */
async function readSection(
  tx: Transaction,
  declarationId: string,
  key: DeclarationSectionKey,
): Promise<{
  declaration: DeclarationRow;
  section: SectionRow;
  sibling: SectionRow | null;
} | null> {
  const declaration = await liveDeclaration(tx, declarationId);
  if (!declaration) return null;
  const siblingKey = key === 'bio' ? 'household' : key === 'household' ? 'bio' : null;
  const rows = await tx
    .select()
    .from(declarationSections)
    .where(
      and(
        eq(declarationSections.declarationId, declarationId),
        sql`${declarationSections.sectionKey} in (${key}, ${siblingKey ?? key})`,
      ),
    );
  const section = rows.find((row) => row.sectionKey === key);
  if (!section) return null;
  const sibling = siblingKey ? (rows.find((row) => row.sectionKey === siblingKey) ?? null) : null;
  return { declaration, section, sibling };
}

function inScheduleOrder<T extends Pick<SectionSummaryRow, 'sectionKey' | 'createdAt'>>(
  sections: T[],
): T[] {
  return [...sections].sort(
    (a, b) =>
      sectionRank(a.sectionKey) - sectionRank(b.sectionKey) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.sectionKey.localeCompare(b.sectionKey),
  );
}

/** The unique constraint a failed query violated, looking through Drizzle's error wrapper. */
export function violatedUniqueConstraint(error: unknown): string | undefined {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ('code' in cause && cause.code === '23505' && 'constraint' in cause) {
      return typeof cause.constraint === 'string' ? cause.constraint : undefined;
    }
  }
  return undefined;
}
