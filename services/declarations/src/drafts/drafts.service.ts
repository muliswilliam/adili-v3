import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import type { DeclarationSectionKey } from '@adili/forms';
import { and, eq, max, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { DeclarationsSchema } from '../db/schema.js';
import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import type { Transaction } from '../obligations/apply-page.js';
import { fallbackIssuerCode } from '../obligations/access.js';
import { commissionRefs, filingObligations } from '../obligations/schema.js';
import { assessSections, type DraftSections, type SectionAssessment } from './completeness.js';
import { deriveHeader } from './derive.js';
import { declarationDraftStarted } from './events.js';
import type { Declaration, SectionEnvelope, SectionSaveResult } from './representation.js';
import { SectionCipher, type StoredSection } from './section-cipher.js';
import {
  applyLockedFields,
  displayName,
  emptyHousehold,
  emptyOther,
  emptyStatement,
  isSectionKey,
  prefillBio,
  type SectionContents,
  sectionMetadata,
  sectionRank,
  shapeErrors,
  statementPersonKey,
} from './sections.js';
import { declarationSections, declarations, type SectionMetadata } from './schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Obligations a declaration can no longer be started for. */
const CLOSED_OBLIGATION_STATUSES = new Set(['filed', 'cancelled']);

type DeclarationRow = typeof declarations.$inferSelect;
type SectionRow = typeof declarationSections.$inferSelect;

/** Sections of a draft without their contents, as the header lists them. */
type SectionSummaryRow = Omit<SectionRow, 'ciphertext' | 'envelope'>;

/**
 * Declaration drafts (spec 05): start from an obligation, read the draft, read and save its
 * capture sections. Every route is the declarant's own by the `person_id` claim, under
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
  ) {}

  /**
   * The declarant's draft for the obligation: the existing live one (`created: false`), or a new
   * one derived from the obligation with bio pre-filled from the roster record. 409 when the
   * obligation is filed or cancelled.
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
    if (existing) return { created: false, declaration: await this.read(person, existing.id) };
    if (CLOSED_OBLIGATION_STATUSES.has(obligation.status)) {
      throw new ProblemException({
        type: 'obligation-closed',
        title: 'Obligation filed or cancelled',
        status: HttpStatus.CONFLICT,
        detail: `No declaration can be started for a ${obligation.status} obligation.`,
      });
    }

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
    const contents = await this.open(state.declaration, state.section);
    const issues =
      state.section.completeness === 'not-started' || state.section.completeness === 'archived'
        ? []
        : (await this.assess(state.declaration, key, contents, state.sibling)).section.issues;
    return {
      key,
      completeness: state.section.completeness,
      contents,
      issues,
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

    const stored = await this.open(declaration, section);
    const contents = this.prepare(declaration, key, body, stored, section.metadata);
    const assessment = await this.assess(declaration, key, contents, state.sibling);
    const metadata: SectionMetadata = {
      ...section.metadata,
      ...sectionMetadata(key, contents),
    };
    const sealed = await this.sections.seal(declaration.tenant, declaration.id, key, contents);

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
      const now = new Date();
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
      return bumped.draftVersion;
    });
    await this.sections.cache(
      { declarationId: declaration.id, sectionKey: key, savedVersion: draftVersion },
      contents,
    );
    return {
      key,
      completeness: assessment.section.completeness,
      draftVersion,
      issues: assessment.section.issues,
      sectionsChanged: [],
    };
  }

  /**
   * The contents to store for a well-formed body: the service's own fields enforced. Household
   * and paragraph 9 rules (statements created and archived, material changes composed) plug in
   * here per section.
   */
  private prepare(
    declaration: DeclarationRow,
    key: DeclarationSectionKey,
    body: SectionContents,
    stored: SectionContents,
    metadata: SectionMetadata,
  ): SectionContents {
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
        ...body,
        personKey,
        personName: stored.personName,
        statementDate: declaration.statementDate,
        incomePeriod: { from: declaration.incomePeriodFrom, to: declaration.incomePeriodTo },
      };
    }
    return body;
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
      // Names of whose statements they are live in bio and household, encrypted.
      const named = await tx
        .select()
        .from(declarationSections)
        .where(
          and(
            eq(declarationSections.declarationId, declarationId),
            sql`${declarationSections.sectionKey} in ('bio', 'household')`,
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

  /** Display names by person key: the officer from bio, spouses and children from household. */
  private async personNames(
    declaration: DeclarationRow,
    named: SectionRow[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const section of named) {
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

function personOf(principal: Principal): PersonContext {
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

function validationProblem(errors: { path: string; message: string }[]): ProblemException {
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

function sectionIs(declarationId: string, sectionKey: string) {
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
function violatedUniqueConstraint(error: unknown): string | undefined {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ('code' in cause && cause.code === '23505' && 'constraint' in cause) {
      return typeof cause.constraint === 'string' ? cause.constraint : undefined;
    }
  }
  return undefined;
}
