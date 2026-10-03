import type { EventPublisher } from '@adili/events';
import type { DeclarationSectionKey } from '@adili/forms';
import { and, eq, inArray, like, ne, type SQL, sql } from 'drizzle-orm';

import { declarations, EDITABLE_STATUSES } from '../declaration/schema.js';
import type { Transaction } from '../db/transaction.js';
import { isUuid } from '../guards.js';
import type { ObligationStatus } from '../obligations/engine.js';
import { filingObligations } from '../obligations/schema.js';
import { declarationAttachmentUnlinked } from './events.js';
import {
  declarationAttachments,
  declarationSections,
  type SectionCompleteness,
  type SectionMetadata,
} from './schema.js';
import type { SectionCipher } from './section-cipher.js';
import type { DocumentFrame } from './summary.js';
import {
  type SectionContents,
  sectionRank,
  siblingSection,
  STATEMENT_KEY_PATTERN,
} from './sections.js';

/**
 * The drafts' reads and the one write every section change goes through, inside a transaction
 * the caller opened under the declarant's row-level security (`withPerson`).
 */

export type DeclarationRow = typeof declarations.$inferSelect;
export type SectionRow = typeof declarationSections.$inferSelect;

/**
 * The declaration unless it is discarded, locked for a change when `lock` is set. Null when the
 * id is not a UUID, the caller cannot see it or it does not exist.
 */
export async function liveDeclaration(
  tx: Transaction,
  declarationId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<DeclarationRow | null> {
  if (!isUuid(declarationId)) return null;
  const query = tx
    .select()
    .from(declarations)
    .where(and(eq(declarations.id, declarationId), ne(declarations.status, 'discarded')))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/** The obligation's declaration unless it is discarded (there is at most one). */
export async function liveDeclarationOf(
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

/** What of its filing obligation a declaration's submission and amendment rules read. */
export interface DeclarationObligation {
  id: string;
  status: ObligationStatus;
  statementDate: string;
  dueDate: string;
}

/**
 * The declaration's filing obligation, locked for a change when `lock` is set. Every declaration
 * has one, visible wherever the declaration is (the declarant's own, or the Commission's), so a
 * missing one is a bug, not a 404.
 */
export async function obligationOf(
  tx: Transaction,
  declaration: Pick<DeclarationRow, 'id' | 'obligationId'>,
  { lock = false }: { lock?: boolean } = {},
): Promise<DeclarationObligation> {
  const query = tx
    .select({
      id: filingObligations.id,
      status: filingObligations.status,
      statementDate: filingObligations.statementDate,
      dueDate: filingObligations.dueDate,
    })
    .from(filingObligations)
    .where(eq(filingObligations.id, declaration.obligationId))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new Error(`Declaration ${declaration.id} has no obligation`);
  return row;
}

/** What the service fixed when the draft started: the header of its document. */
export function documentFrame(declaration: DeclarationRow): DocumentFrame {
  return {
    type: declaration.type,
    statementDate: declaration.statementDate,
    incomePeriod: {
      ...incomePeriodOf(declaration),
      fromSource: declaration.previousStatementDateSource,
    },
  };
}

/** The declaration's income period, as its statements carry it. */
export function incomePeriodOf(declaration: DeclarationRow): { from: string; to: string } {
  return { from: declaration.incomePeriodFrom, to: declaration.incomePeriodTo };
}

export function sectionIs(declarationId: string, sectionKey: DeclarationSectionKey) {
  return and(
    eq(declarationSections.declarationId, declarationId),
    eq(declarationSections.sectionKey, sectionKey),
  );
}

/** The declaration's sections of the given keys (at least one). */
export function sectionsAre(declarationId: string, sectionKeys: readonly DeclarationSectionKey[]) {
  return and(
    eq(declarationSections.declarationId, declarationId),
    inArray(declarationSections.sectionKey, [...sectionKeys]),
  );
}

/**
 * A live declaration's section with its contents, and for bio and household the other of the
 * two (they are assessed together). Null when the caller cannot see it or it does not exist.
 */
export async function readSection(
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
  const siblingKey = siblingSection(key);
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

/** Every statement of the draft, archived ones included. */
export function statementSections(tx: Transaction, declarationId: string): Promise<SectionRow[]> {
  return tx
    .select()
    .from(declarationSections)
    .where(
      and(
        eq(declarationSections.declarationId, declarationId),
        like(declarationSections.sectionKey, STATEMENT_KEY_PATTERN),
      ),
    );
}

/** First Schedule order, statements of a kind in the order they were created. */
export function inScheduleOrder<T extends Pick<SectionRow, 'sectionKey' | 'createdAt'>>(
  sections: T[],
): T[] {
  return [...sections].sort(
    (a, b) =>
      sectionRank(a.sectionKey) - sectionRank(b.sectionKey) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.sectionKey.localeCompare(b.sectionKey),
  );
}

/** What a section change sets besides its sealed contents. */
export interface SectionWrite {
  now: Date;
  /** Bump only from this draft version, and only while editable (a save's `If-Match`). */
  ifVersion?: number;
  /** Record the section as the one saved last, for "Continue". */
  lastSection?: boolean;
  completeness?: SectionCompleteness;
  metadata?: SectionMetadata;
}

/**
 * Seals the section's contents, bumps the draft version and stores the section at the new
 * version: the one write of a section save, a link and an unlink. The new draft version, or null
 * when `ifVersion` no longer holds (another save came first).
 */
export async function storeSection(
  tx: Transaction,
  cipher: SectionCipher,
  declaration: DeclarationRow,
  key: DeclarationSectionKey,
  contents: SectionContents,
  write: SectionWrite,
): Promise<number | null> {
  const sealed = await cipher.seal(declaration.tenant, declaration.id, key, contents);
  const [bumped] = await tx
    .update(declarations)
    .set({
      draftVersion: sql`${declarations.draftVersion} + 1`,
      ...(write.lastSection && { lastSection: key }),
    })
    .where(
      and(
        eq(declarations.id, declaration.id),
        ...(write.ifVersion === undefined
          ? []
          : [
              eq(declarations.draftVersion, write.ifVersion),
              inArray(declarations.status, EDITABLE_STATUSES),
            ]),
      ),
    )
    .returning({ draftVersion: declarations.draftVersion });
  if (!bumped) return null;
  await tx
    .update(declarationSections)
    .set({
      ciphertext: sealed.ciphertext,
      envelope: sealed.envelope,
      ...(write.completeness && { completeness: write.completeness }),
      ...(write.metadata && { metadata: write.metadata }),
      savedVersion: bumped.draftVersion,
      updatedAt: write.now,
    })
    .where(sectionIs(declaration.id, key));
  return bumped.draftVersion;
}

/**
 * Deletes the draft's attachment rows that `which` selects and records an unlink event for each:
 * the one way an attachment goes (unlink, a save removing its item, discard). The upload ids.
 */
export async function deleteAttachments(
  tx: Transaction,
  events: EventPublisher,
  declaration: DeclarationRow,
  which?: SQL,
): Promise<string[]> {
  const deleted = await tx
    .delete(declarationAttachments)
    .where(and(eq(declarationAttachments.declarationId, declaration.id), which))
    .returning({ uploadId: declarationAttachments.uploadId });
  for (const { uploadId } of deleted) {
    await events.record(
      tx,
      declarationAttachmentUnlinked(declaration.tenant, {
        declarationId: declaration.id,
        uploadId,
      }),
    );
  }
  return deleted.map(({ uploadId }) => uploadId);
}
