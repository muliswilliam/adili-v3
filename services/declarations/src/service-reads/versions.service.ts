import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import type { DeclarationV1 } from '@adili/forms';
import { and, desc, eq, lt, ne, or } from 'drizzle-orm';

import type { DeclarationsSchema } from '../db/schema.js';
import { declarations, declarationVersions } from '../declaration/schema.js';
import { openSnapshot, versionRow } from '../declaration/versions.js';
import { filingObligations, rosterSnapshots } from '../obligations/schema.js';
import type {
  InternalPreviousVersion,
  InternalVersionDocument,
  PreviousVersionQuery,
} from './representation.js';

/** Who a service reads for: the Commission it acts for and the subject of its token. */
export interface ServiceRead {
  tenant: string;
  subject: string;
}

/**
 * Submitted versions as the review service reads them (spec 07a #155): one version as filed,
 * decrypted, with what the case shows of the declarant; and the person's latest earlier version
 * at the Commission. Only the acting Commission's versions are seen (RLS); anything else is 404.
 */
@Injectable()
export class ServiceVersionsService {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly cipher: FieldCipher,
  ) {}

  /** A version of the Commission's declaration as filed; 404 when it has no such version. */
  async document(
    read: ServiceRead,
    declarationId: string,
    version: number,
  ): Promise<InternalVersionDocument> {
    const found = await withTenant(this.db, read, async (tx) => {
      const row = await versionRow(tx, declarationId, version);
      if (!row) return null;
      const [context] = await tx
        .select({
          type: declarations.type,
          statementDate: declarations.statementDate,
          rosterRecordId: declarations.rosterRecordId,
          dueDate: filingObligations.dueDate,
          fullName: rosterSnapshots.fullName,
          personnelFileNumber: rosterSnapshots.personnelFileNumber,
          reportingEntityId: rosterSnapshots.reportingEntityId,
        })
        .from(declarations)
        .innerJoin(filingObligations, eq(filingObligations.id, declarations.obligationId))
        .leftJoin(rosterSnapshots, eq(rosterSnapshots.rosterRecordId, declarations.rosterRecordId))
        .where(and(eq(declarations.id, row.declarationId), eq(declarations.tenant, read.tenant)));
      return context ? { row, context } : null;
    });
    const { row, context } = notFoundIfInvisible(found);
    const document = await openSnapshot(this.cipher, row);
    return {
      declarationId: row.declarationId,
      versionId: row.id,
      version: row.version,
      personId: row.personId,
      rosterRecordId: context.rosterRecordId,
      reportingEntityId: context.reportingEntityId,
      reference: row.reference,
      type: context.type,
      statementDate: context.statementDate,
      submittedAt: row.submittedAt.toISOString(),
      late: row.late,
      dueDate: context.dueDate,
      declarantName: context.fullName ?? nameOf(document),
      personnelFileNumber: context.personnelFileNumber ?? '',
      document: document as unknown as Record<string, unknown>,
      attachments: attachmentsOf(document),
    };
  }

  /**
   * The person's latest version at the Commission submitted before `beforeVersionId` (an earlier
   * version of the same declaration included); 404 for a first, or when the Commission has no
   * such version of the person.
   */
  async previous(
    read: ServiceRead,
    { personId, beforeVersionId }: PreviousVersionQuery,
  ): Promise<InternalPreviousVersion> {
    const found = await withTenant(this.db, read, async (tx) => {
      const [before] = await tx
        .select()
        .from(declarationVersions)
        .where(
          and(
            eq(declarationVersions.id, beforeVersionId),
            eq(declarationVersions.personId, personId),
            eq(declarationVersions.tenant, read.tenant),
          ),
        );
      if (!before) return null;
      const [earlier] = await tx
        .select({
          declarationId: declarationVersions.declarationId,
          versionId: declarationVersions.id,
          version: declarationVersions.version,
          statementDate: declarations.statementDate,
          submittedAt: declarationVersions.submittedAt,
        })
        .from(declarationVersions)
        .innerJoin(declarations, eq(declarations.id, declarationVersions.declarationId))
        .where(
          and(
            eq(declarationVersions.personId, personId),
            eq(declarationVersions.tenant, read.tenant),
            ne(declarationVersions.id, before.id),
            or(
              lt(declarationVersions.submittedAt, before.submittedAt),
              and(
                eq(declarationVersions.declarationId, before.declarationId),
                lt(declarationVersions.version, before.version),
              ),
            ),
          ),
        )
        .orderBy(desc(declarationVersions.submittedAt), desc(declarationVersions.version))
        .limit(1);
      return earlier ?? null;
    });
    const earlier = notFoundIfInvisible(found);
    return { ...earlier, submittedAt: earlier.submittedAt.toISOString() };
  }
}

/** The declarant's name as the document gives it, when the roster snapshot is missing. */
function nameOf(document: DeclarationV1): string {
  const name = document.officer.name;
  return [name.firstName, name.otherNames, name.surname]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}

/** Every attachment of the filed items, with the item and the statement it belongs to. */
function attachmentsOf(document: DeclarationV1): InternalVersionDocument['attachments'] {
  return document.statements.flatMap((statement) =>
    [...statement.income, ...statement.assets, ...statement.liabilities].flatMap((item) =>
      (item.attachments ?? []).map((attachment) => ({
        uploadId: attachment.uploadId,
        itemId: item.id,
        personKey: statement.personKey,
        fileName: attachment.fileName,
        sha256: attachment.sha256,
      })),
    ),
  );
}
