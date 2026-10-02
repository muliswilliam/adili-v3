import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { declarations, declarationVersions } from '../declaration/schema.js';
import { declaredName, openSnapshot, versionRow } from '../declaration/versions.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { commissionRefs } from '../obligations/schema.js';
import type { CommissionRef } from '../obligations/representation.js';
import type {
  DisclosedVersion,
  DisclosureDocument,
  DisclosureRequest,
  FullVersionDocument,
} from './representation.js';
import { disclose } from './scope.js';

/**
 * Decrypting submitted declarations for someone other than the Commission (spec 10): the scoped
 * disclosure of an access grant, and a version in full for the declarant's certified copy. The
 * only place in the platform that does (the access service holds no content); the routes audit
 * every read with its legal basis and recipient. Reads run in the acting Commission's context:
 * another Commission's declarations are invisible, so 404.
 */
@Injectable()
export class DisclosureService {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly cipher: FieldCipher,
  ) {}

  /**
   * The `disclosure.v1` document of a grant: for each granted year, the version in force of each
   * of the person's declarations at the Commission, cut to the granted persons and sections, and
   * the ids of the versions it discloses, for the audit trail. 404 when the person has none in
   * any granted year (or is not the Commission's declarant).
   */
  async render(
    tenant: string,
    subject: string,
    request: DisclosureRequest,
  ): Promise<{ disclosure: DisclosureDocument; versionIds: string[] }> {
    const found = await withTenant(this.db, { tenant, subject }, async (tx) => {
      const rows = await tx
        .select({
          version: declarationVersions,
          type: declarations.type,
          statementDate: declarations.statementDate,
        })
        .from(declarationVersions)
        .innerJoin(declarations, eq(declarations.id, declarationVersions.declarationId))
        .where(
          and(
            eq(declarationVersions.personId, request.personId),
            inArray(declarationVersions.cycleYear, [...new Set(request.years)]),
            isNull(declarationVersions.supersededAt),
          ),
        )
        .orderBy(asc(declarations.statementDate), asc(declarationVersions.reference));
      if (rows.length === 0) return null;
      return { rows, commission: await commissionOf(tx, tenant) };
    });
    const { rows, commission } = notFoundIfInvisible(found);

    const scope = {
      includeSpouses: request.includeSpouses,
      includeChildren: request.includeChildren,
      sections: request.sections,
    };
    const opened = await Promise.all(
      rows.map(async (row) => ({ row, document: await openSnapshot(this.cipher, row.version) })),
    );
    // Ordered by statement date: the person as they named themselves last.
    const latest = opened.reduce((_, next) => next);
    const disclosure: DisclosureDocument = {
      schemaVersion: 'disclosure.v1',
      grantReference: request.grantReference,
      personName: declaredName(latest.document),
      commission,
      versions: opened.map(({ row, document }): DisclosedVersion => ({
        reference: row.version.reference,
        version: row.version.version,
        type: row.type,
        statementDate: row.statementDate,
        submittedAt: row.version.submittedAt.toISOString(),
        content: { ...disclose(document, scope) },
      })),
    };
    return { disclosure, versionIds: rows.map((row) => row.version.id) };
  }

  /**
   * A version of the Commission's declarations in full, for the certified copy of the declarant
   * `personId`: 404 when the version is not theirs, or not the Commission's.
   */
  async fullDocument(
    tenant: string,
    subject: string,
    {
      declarationId,
      version,
      personId,
    }: { declarationId: string; version: number; personId: string },
  ): Promise<FullVersionDocument> {
    const found = await withTenant(this.db, { tenant, subject }, async (tx) => {
      const row = await versionRow(tx, declarationId, version);
      if (row?.personId !== personId) return null;
      const [declaration] = await tx
        .select({ type: declarations.type, statementDate: declarations.statementDate })
        .from(declarations)
        .where(eq(declarations.id, row.declarationId));
      if (!declaration) return null;
      return { row, declaration, commission: await commissionOf(tx, tenant) };
    });
    const { row, declaration, commission } = notFoundIfInvisible(found);
    const document = await openSnapshot(this.cipher, row);
    return {
      declarationId: row.declarationId,
      versionId: row.id,
      version: row.version,
      personId: row.personId,
      reference: row.reference,
      type: declaration.type,
      statementDate: declaration.statementDate,
      submittedAt: row.submittedAt.toISOString(),
      canonicalSha256: row.canonicalSha256,
      commission,
      declarantName: declaredName(document),
      document: document as unknown as Record<string, unknown>,
    };
  }
}

/** The Commission's reference; the read model has every Commission, so a gap is transient. */
async function commissionOf(tx: Transaction, tenant: string): Promise<CommissionRef> {
  const [commission] = await tx
    .select({
      slug: commissionRefs.slug,
      issuerCode: commissionRefs.issuerCode,
      name: commissionRefs.name,
    })
    .from(commissionRefs)
    .where(eq(commissionRefs.slug, tenant));
  if (!commission) throw new Error(`No Commission reference for ${tenant}`);
  return commission;
}
