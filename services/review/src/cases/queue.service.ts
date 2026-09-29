import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
} from 'drizzle-orm';

import type { ReviewSchema } from '../db/schema.js';
import { queueTenant } from './access.js';
import { decodeQueueCursor, encodeQueueCursor, type QueueQuery } from './queue-query.js';
import {
  caseListItem,
  type CasePage,
  type LatestClarification,
  type QueueSummary,
} from './representation.js';
import { CASE_STATUSES, clarifications, PRIORITY_BANDS, reviewCases } from './schema.js';

/**
 * A Commission's review queue (spec 07a): its cases ordered by score, then oldest first, with
 * filters and search, and the counts by status and band. Only the Commission's reviewers and
 * supervisors see it; everyone else gets 404. Reads run under the tenant's row-level security.
 */
@Injectable()
export class QueueService {
  constructor(@InjectDatabase() private readonly db: Database<ReviewSchema>) {}

  async list(principal: Principal, slug: string, query: QueueQuery): Promise<CasePage> {
    const tenant = queueTenant(principal, slug);
    const cursor = query.cursor === undefined ? undefined : decodeQueueCursor(query.cursor);
    if (cursor === null) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Bad Request',
        status: HttpStatus.BAD_REQUEST,
        detail: 'The cursor is not one this queue issued.',
      });
    }
    const conditions: (SQL | undefined)[] = [
      eq(reviewCases.tenant, tenant),
      ...filters(principal, query),
    ];
    if (cursor) {
      const receivedAt = new Date(cursor.receivedAt);
      conditions.push(
        or(
          lt(reviewCases.score, cursor.score),
          and(eq(reviewCases.score, cursor.score), gt(reviewCases.receivedAt, receivedAt)),
          and(
            eq(reviewCases.score, cursor.score),
            eq(reviewCases.receivedAt, receivedAt),
            gt(reviewCases.id, cursor.id),
          ),
        ),
      );
    }

    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(reviewCases)
        .where(and(...conditions))
        .orderBy(desc(reviewCases.score), asc(reviewCases.receivedAt), asc(reviewCases.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const latest = new Map<string, LatestClarification>();
      if (page.length > 0) {
        const issued = await tx
          .select({
            caseId: clarifications.caseId,
            status: clarifications.status,
            dueAt: clarifications.dueAt,
          })
          .from(clarifications)
          .where(
            and(
              inArray(
                clarifications.caseId,
                page.map((row) => row.id),
              ),
              ne(clarifications.status, 'draft'),
            ),
          )
          .orderBy(asc(clarifications.issuedAt));
        for (const clarification of issued) latest.set(clarification.caseId, clarification);
      }

      const last = page.at(-1);
      return {
        items: page.map((row) => caseListItem(row, latest.get(row.id))),
        nextCursor:
          rows.length > query.limit && last
            ? encodeQueueCursor({
                score: last.score,
                receivedAt: last.receivedAt.toISOString(),
                id: last.id,
              })
            : null,
      };
    });
  }

  async summary(principal: Principal, slug: string): Promise<QueueSummary> {
    const tenant = queueTenant(principal, slug);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const byStatus = await tx
        .select({ status: reviewCases.status, count: count() })
        .from(reviewCases)
        .where(eq(reviewCases.tenant, tenant))
        .groupBy(reviewCases.status);
      const byBand = await tx
        .select({ band: reviewCases.band, count: count() })
        .from(reviewCases)
        .where(eq(reviewCases.tenant, tenant))
        .groupBy(reviewCases.band);
      const [overdue] = await tx
        .select({ count: count() })
        .from(clarifications)
        .where(and(eq(clarifications.tenant, tenant), eq(clarifications.status, 'overdue')));
      return {
        byStatus: tally(CASE_STATUSES, byStatus, (row) => row.status),
        byBand: tally(PRIORITY_BANDS, byBand, (row) => row.band),
        overdueClarifications: overdue?.count ?? 0,
      };
    });
  }
}

function filters(principal: Principal, query: QueueQuery): (SQL | undefined)[] {
  const where: (SQL | undefined)[] = [];
  if (query.status) where.push(eq(reviewCases.status, query.status));
  if (query.band) where.push(eq(reviewCases.band, query.band));
  if (query.type) where.push(eq(reviewCases.type, query.type));
  if (query.cycle !== undefined) where.push(eq(reviewCases.cycleYear, query.cycle));
  if (query.late !== undefined) where.push(eq(reviewCases.late, query.late));
  if (query.openClarification !== undefined) {
    where.push(
      query.openClarification
        ? gt(reviewCases.openClarifications, 0)
        : eq(reviewCases.openClarifications, 0),
    );
  }
  switch (query.assignee) {
    case undefined:
    case 'any':
      break;
    case 'mine':
      where.push(eq(reviewCases.assignee, principal.subject));
      break;
    case 'unassigned':
      where.push(isNull(reviewCases.assignee));
      break;
    default:
      where.push(eq(reviewCases.assignee, query.assignee));
  }
  if (query.search !== undefined) {
    const text = escapeLike(query.search);
    where.push(
      or(
        ilike(reviewCases.reference, `${text}%`),
        ilike(reviewCases.personnelFileNumber, `${text}%`),
        ilike(reviewCases.declarantName, `%${text}%`),
      ),
    );
  }
  return where;
}

/** `text` with LIKE's wildcards and escape character taken literally. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Counts per key, with every key present (zero when no row has it). */
function tally<K extends string, R extends { count: number }>(
  keys: readonly K[],
  rows: R[],
  keyOf: (row: R) => K,
): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const row of rows) counts[keyOf(row)] = row.count;
  return counts;
}
