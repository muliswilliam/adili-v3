import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { ATTESTATION_TEXT, type DeclarationSectionKey, type PersonKey } from '@adili/forms';

import { and, count, desc, eq, inArray, max, ne, notInArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import { isRecord, isUuid, UUID } from '../guards.js';
import { commissionRef } from '../obligations/access.js';
import { nairobiDate } from '../obligations/dates.js';
import { commissionRefs, filingObligations } from '../obligations/schema.js';
import { acknowledgementOf } from '../declaration/acknowledgement.js';
import { declarations, declarationVersions, isEditable } from '../declaration/schema.js';
import { amendRefusal, isLate, submitRefusal } from '../declaration/window.js';
import { personOf } from './access.js';
import { itemIds, keepAttachments } from './attachments.js';
import { assessSections, type DraftSections, type SectionAssessment } from './completeness.js';
import { deriveHeader } from './derive.js';
import {
  declarationAttachmentUnlinked,
  declarationDraftDiscarded,
  declarationDraftStarted,
} from './events.js';
import { duplicatePeople, householdPeople, type NotIncluded } from './household.js';
import { composeMaterialChanges } from './material-changes.js';
import {
  declarationNotDraft,
  sectionArchived,
  validationProblem,
  versionMismatch,
  violatedUniqueConstraint,
} from './problems.js';
import {
  type DeclarationRow,
  documentFrame,
  incomePeriodOf,
  inScheduleOrder,
  liveDeclaration,
  liveDeclarationOf,
  liveSections,
  obligationOf,
  readSection,
  sectionIs,
  statementSections,
  storeSection,
} from './repository.js';
import type {
  Declaration,
  DeclarationListItem,
  DeclarationSummary,
  SectionEnvelope,
  SectionSaveResult,
} from './representation.js';
import { SectionCipher, type StoredSection } from './section-cipher.js';
import {
  applyLockedFields,
  emptyHousehold,
  emptyOther,
  emptyStatement,
  isSectionKey,
  isStatementKey,
  nilConflicts,
  prefillBio,
  type SectionContents,
  sectionMetadata,
  shapeErrors,
  siblingSection,
  type StatementKey,
  statementKey,
  statementPersonKey,
} from './sections.js';
import { personNames, statementChanges, writeStatementChanges } from './statements.js';
import { reviewDraft } from './summary.js';
import {
  declarationAttachments,
  declarationSections,
  obligationDrafts,
  type SectionMetadata,
} from './schema.js';

/** Obligations a declaration can no longer be started for. */
const CLOSED_OBLIGATION_STATUSES = new Set(['filed', 'cancelled']);

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
          and(
            eq(declarations.personId, person.personId),
            // A declaration being amended was submitted all the same.
            inArray(declarations.status, ['submitted', 'amending']),
          ),
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
        statementKey('officer'),
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
        await tx.insert(obligationDrafts).values({
          obligationId,
          declarationId: id,
          tenant: obligation.tenant,
          personId: person.personId,
        });
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
   * validates, what blocks submission by section and field, and the solemn declaration. Whether
   * it can be submitted now follows the submit transaction's own rules (spec 06), all but the
   * step-up, which the portal asks for when the declarant presses Submit.
   */
  async summary(principal: Principal, declarationId: string): Promise<DeclarationSummary> {
    const person = personOf(principal);
    const found = await withPerson(this.db, person, async (tx) => {
      const declaration = await liveDeclaration(tx, declarationId);
      if (!declaration) return null;
      return {
        declaration,
        obligation: await obligationOf(tx, declaration),
        sections: await liveSections(tx, declaration.id),
      };
    });
    const { declaration, obligation, sections } = notFoundIfInvisible(found);
    const review = reviewDraft(
      documentFrame(declaration),
      await this.sections.openAll(declaration.tenant, sections),
      sections.map((section) => ({ key: section.sectionKey, completeness: section.completeness })),
    );
    const today = nairobiDate(this.clock.now());
    const refusal = submitRefusal(declaration.status, obligation, today);
    const cannotSubmitReason = refusal ?? (review.valid ? null : 'incomplete');
    return {
      declaration: await this.read(person, declaration.id),
      document: review.document,
      valid: review.valid,
      blocking: review.blocking,
      canSubmit: cannotSubmitReason === null,
      cannotSubmitReason,
      late: isLate(obligation.dueDate, today),
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
    await withPerson(this.db, person, async (tx) => {
      const declaration = notFoundIfInvisible(
        await liveDeclaration(tx, declarationId, { lock: true }),
      );
      if (declaration.status !== 'draft') throw declarationNotDraft('discarded');
      const unlinked = await tx
        .delete(declarationAttachments)
        .where(eq(declarationAttachments.declarationId, declaration.id))
        .returning({ uploadId: declarationAttachments.uploadId });
      await tx
        .delete(declarationSections)
        .where(eq(declarationSections.declarationId, declaration.id));
      await tx
        .update(declarations)
        .set({ status: 'discarded' })
        .where(eq(declarations.id, declaration.id));
      await tx.delete(obligationDrafts).where(eq(obligationDrafts.declarationId, declaration.id));
      for (const { uploadId } of unlinked) {
        await this.events.record(
          tx,
          declarationAttachmentUnlinked(declaration.tenant, {
            declarationId: declaration.id,
            uploadId,
          }),
        );
      }
      await this.events.record(
        tx,
        declarationDraftDiscarded(declaration.tenant, { declarationId: declaration.id }),
      );
    });
  }

  /**
   * The declarant's live declarations (S16), last updated first, each with how much is complete
   * (complete sections out of the live ones, archived statements left out) and, once submitted,
   * what "My declarations" shows of it (spec 06): the reference, the version in force with its
   * submission time, lateness and acknowledgement slip, and whether Amend is open today.
   */
  async mine(principal: Principal): Promise<DeclarationListItem[]> {
    const person = personOf(principal);
    const found = await withPerson(this.db, person, async (tx) => {
      const rows = await tx
        .select()
        .from(declarations)
        .where(
          and(eq(declarations.personId, person.personId), ne(declarations.status, 'discarded')),
        )
        .orderBy(desc(declarations.updatedAt), desc(declarations.id));
      if (rows.length === 0) return null;
      const ids = rows.map((row) => row.id);
      const completeness = await tx
        .select({
          declarationId: declarationSections.declarationId,
          completeness: declarationSections.completeness,
          sections: count(),
        })
        .from(declarationSections)
        .where(
          and(
            inArray(declarationSections.declarationId, ids),
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
      const obligations = await tx
        .select({
          id: filingObligations.id,
          status: filingObligations.status,
          dueDate: filingObligations.dueDate,
        })
        .from(filingObligations)
        .where(
          inArray(
            filingObligations.id,
            rows.map((row) => row.obligationId),
          ),
        );
      // The versions in force, one per submitted declaration.
      const inForce = await tx
        .select()
        .from(declarationVersions)
        .innerJoin(
          declarations,
          and(
            eq(declarations.id, declarationVersions.declarationId),
            eq(declarations.currentVersion, declarationVersions.version),
          ),
        )
        .where(inArray(declarationVersions.declarationId, ids));
      return {
        rows,
        completeness,
        commissions,
        obligations: new Map(obligations.map((obligation) => [obligation.id, obligation])),
        versions: new Map(
          inForce.map(({ declaration_versions: version }) => [version.declarationId, version]),
        ),
      };
    });
    if (!found) return [];
    const { rows, completeness, commissions, obligations, versions } = found;
    const bySlug = new Map(commissions.map((commission) => [commission.slug, commission]));
    const now = this.clock.now();
    const today = nairobiDate(now);
    return rows.map((row) => {
      const counted = completeness.filter((group) => group.declarationId === row.id);
      const live = counted.reduce((sum, group) => sum + group.sections, 0);
      const complete = counted
        .filter((group) => group.completeness === 'complete')
        .reduce((sum, group) => sum + group.sections, 0);
      const obligation = obligations.get(row.obligationId);
      if (!obligation) throw new Error(`Declaration ${row.id} has no obligation`);
      const version = versions.get(row.id);
      const acknowledgement = version ? acknowledgementOf(version, now) : null;
      return {
        id: row.id,
        obligationId: row.obligationId,
        commission: commissionRef(row.tenant, bySlug.get(row.tenant)),
        type: row.type,
        statementDate: row.statementDate,
        status: row.status,
        completenessPercent: live === 0 ? 0 : Math.floor((complete * 100) / live),
        dueDate: obligation.dueDate,
        reference: row.reference,
        currentVersion: row.currentVersion,
        amendingFromVersion: row.amendingFromVersion,
        submittedAt: version?.submittedAt.toISOString() ?? null,
        late: version?.late ?? null,
        amendable: amendRefusal(row.status, obligation, today) === null,
        acknowledgement: acknowledgement && {
          status: acknowledgement.status,
          documentId: acknowledgement.documentId,
          verifiedCount: acknowledgement.verifiedCount,
        },
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
    const opened = await this.sections.open(state.declaration.tenant, state.section);
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
    if (!isEditable(declaration.status)) throw declarationNotDraft('edited');
    if (declaration.draftVersion !== expected) throw versionMismatch();
    if (section.metadata.archived === true) throw sectionArchived();
    if (!isRecord(body)) throw validationProblem([{ path: '', message: 'Expected an object' }]);
    const errors = shapeErrors(key, body);
    if (errors.length > 0) throw validationProblem(errors);
    if (isStatementKey(key)) {
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

    const stored = await this.sections.open(declaration.tenant, section);
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
    // Saved at the version the conditional bump below produces, or not at all.
    const savedVersion = expected + 1;
    const statements = household
      ? await statementChanges(
          this.sections,
          declaration,
          await withPerson(this.db, person, (tx) => statementSections(tx, declaration.id)),
          household.statements,
          savedVersion,
        )
      : [];

    const now = this.clock.now();
    const draftVersion = await withPerson(this.db, person, async (tx) => {
      const bumped = await storeSection(tx, this.sections, declaration, key, contents, {
        now,
        ifVersion: expected,
        lastSection: true,
        completeness: assessment.section.completeness,
        metadata,
      });
      if (bumped === null) throw versionMismatch();
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
      if (isStatementKey(key)) await this.unlinkRemovedItems(tx, declaration, key, contents);
      return bumped;
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
        incomePeriod: incomePeriodOf(declaration),
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
    key: StatementKey,
    contents: SectionContents,
  ): Promise<void> {
    const kept = itemIds(contents).filter(isUuid);
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
      const other = sibling ? await this.sections.open(declaration.tenant, sibling) : undefined;
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
    const siblingKey = siblingSection(key);
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
      const personKey = statementPersonKey(row.sectionKey);
      if (!personKey && row.sectionKey !== 'bio') continue;
      const contents = await this.sections.open(declaration.tenant, row);
      if (personKey) statements.push([personKey, contents]);
      else bio = contents;
    }
    return composeMaterialChanges({ bio, statements });
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
      const obligation = await obligationOf(tx, declaration);
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
      return { declaration, commission, dueDate: obligation.dueDate, sections, named };
    });
    const { declaration, commission, dueDate, sections, named } = notFoundIfInvisible(found);
    const names = await personNames(this.sections, declaration, named);
    return {
      id: declaration.id,
      obligationId: declaration.obligationId,
      commission: commissionRef(declaration.tenant, commission),
      type: declaration.type,
      statementDate: declaration.statementDate,
      dueDate,
      incomePeriod: {
        ...incomePeriodOf(declaration),
        fromSource: declaration.previousStatementDateSource,
      },
      status: declaration.status,
      schemaVersion: 'declaration.v1',
      draftVersion: declaration.draftVersion,
      sections: inScheduleOrder(sections).map((section) => {
        const personKey = statementPersonKey(section.sectionKey);
        return {
          key: section.sectionKey,
          completeness: section.completeness,
          updatedAt: section.updatedAt?.toISOString() ?? null,
          personName: personKey ? (names.get(personKey) ?? null) : null,
          ...(section.metadata.counts ? { counts: section.metadata.counts } : {}),
        };
      }),
      lastSection: declaration.lastSection,
      reference: declaration.reference,
      currentVersion: declaration.currentVersion,
      amendingFromVersion: declaration.amendingFromVersion,
      createdAt: declaration.createdAt.toISOString(),
      updatedAt: declaration.updatedAt.toISOString(),
    };
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

/** The household's children who get no statement, as stored in its clear metadata. */
function notIncludedOf(metadata: SectionMetadata): NotIncluded[] {
  return (metadata.notIncluded ?? []) as NotIncluded[];
}
