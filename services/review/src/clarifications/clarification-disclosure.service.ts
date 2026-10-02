import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, type TenantContext, withTenant } from '@adili/data-access';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { clarificationResponses, clarifications, reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  type ClarificationCounts,
  type ClarificationCountsRequest,
  type ClarificationDisclosure,
  type ClarificationDisclosureRequest,
  DISCLOSED_STATUSES,
  type DisclosedStatus,
  disclosedClarification,
} from './disclosure.js';

/**
 * The clarifications an access grant discloses (spec 10, decision 7): those issued on the
 * declarant's declarations the grant disclosed, at the acting Commission, cut to the granted
 * household members and sections (disclosure.ts). Every one issued on the declaration counts, not
 * only those asked of the version disclosed: that is the version in force, and a clarification
 * asked of an earlier one explains the amendment that led to it. Drafts and withdrawn
 * clarifications are never disclosed.
 */
@Injectable()
export class ClarificationDisclosureService {
  constructor(@InjectDatabase() private readonly db: Database<ReviewSchema>) {}

  async disclose(
    read: TenantContext,
    request: ClarificationDisclosureRequest,
  ): Promise<{ disclosure: ClarificationDisclosure; clarificationIds: string[] }> {
    const disclosed = inScopeOf(await issuedClarifications(this.db, read, request), request);

    return {
      disclosure: {
        grantReference: request.grantReference,
        clarifications: disclosed.map(({ clarification }) => clarification),
      },
      clarificationIds: disclosed.map(({ id }) => id),
    };
  }

  /**
   * How many clarifications a grant of the scope would disclose (decision 1), per declaration
   * named, zero for one with none; with the ids counted, for the audit trail. Counted on what
   * `disclose` would let out, so a clarification outside the scope never counts.
   */
  async count(
    read: TenantContext,
    request: ClarificationCountsRequest,
  ): Promise<{ counts: ClarificationCounts; clarificationIds: string[] }> {
    const counted = inScopeOf(await issuedClarifications(this.db, read, request), request);
    return {
      counts: {
        counts: [...new Set(request.declarationReferences)].map((declarationReference) => ({
          declarationReference,
          clarifications: counted.filter(
            ({ clarification }) => clarification.declarationReference === declarationReference,
          ).length,
        })),
      },
      clarificationIds: counted.map(({ id }) => id),
    };
  }
}

/** The clarifications issued on the declarations named, of the person, at the Commission. */
function issuedClarifications(
  db: Database<ReviewSchema>,
  read: TenantContext,
  request: ClarificationCountsRequest,
) {
  return withTenant(db, read, (tx) =>
    tx
      .select({
        id: clarifications.id,
        declarationReference: reviewCases.reference,
        reference: clarifications.reference,
        status: clarifications.status,
        issuedAt: clarifications.issuedAt,
        dueAt: clarifications.dueAt,
        respondedAt: clarifications.respondedAt,
        responseLate: clarifications.responseLate,
        resolvedAt: clarifications.resolvedAt,
        items: clarifications.items,
        letter: clarifications.letter,
        responseItems: clarificationResponses.items,
        responseAttachments: clarificationResponses.attachments,
      })
      .from(clarifications)
      .innerJoin(reviewCases, eq(reviewCases.id, clarifications.caseId))
      .leftJoin(
        clarificationResponses,
        eq(clarificationResponses.clarificationId, clarifications.id),
      )
      .where(
        and(
          eq(clarifications.tenant, read.tenant),
          eq(reviewCases.personId, request.personId),
          eq(clarifications.personId, request.personId),
          inArray(reviewCases.reference, request.declarationReferences),
          inArray(clarifications.status, DISCLOSED_STATUSES),
        ),
      )
      .orderBy(asc(clarifications.issuedAt), asc(clarifications.id)),
  );
}

type IssuedRow = Awaited<ReturnType<typeof issuedClarifications>>[number];

/** The row as a grant of the scope would disclose it; null when not issued or none of it is in scope. */
function inScope(row: IssuedRow, scope: ClarificationCountsRequest) {
  // Issued ones carry their reference, issue and due dates; a row without is not issued.
  if (row.reference === null || row.issuedAt === null || row.dueAt === null) return null;
  return disclosedClarification(
    {
      declarationReference: row.declarationReference,
      reference: row.reference,
      status: row.status as DisclosedStatus,
      issuedAt: row.issuedAt,
      dueAt: row.dueAt,
      respondedAt: row.respondedAt,
      responseLate: row.responseLate,
      resolvedAt: row.resolvedAt,
      items: row.items,
      letter: row.letter,
      response:
        row.responseItems === null
          ? null
          : { items: row.responseItems, attachments: row.responseAttachments ?? [] },
    },
    scope,
  );
}

/** The rows a grant of the scope would disclose, each with its id (for the audit trail). */
function inScopeOf(rows: IssuedRow[], scope: ClarificationCountsRequest) {
  return rows.flatMap((row) => {
    const clarification = inScope(row, scope);
    return clarification === null ? [] : [{ id: row.id, clarification }];
  });
}
