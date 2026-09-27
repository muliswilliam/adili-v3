import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, asc, desc, eq, ilike, isNotNull, like, or, type SQL, sql } from 'drizzle-orm';

import { canSeeCommission, tenantContextOf } from '../../commissions/access.js';
import type { Transaction } from '../../commissions/commissions.service.js';
import { decodeCursor, encodeCursor } from '../../commissions/list-query.js';
import type { RosterSummary } from '../../commissions/representation.js';
import { commissions, type DirectorySchema } from '../../db/schema.js';
import {
  reportingEntities,
  rosterImportRows,
  rosterImports,
  rosterRecords,
  type RosterRecordState,
  rosterSummaries,
} from '../schema.js';
import { rosterSummaryColumns, toRosterSummary } from '../summary.js';
import { recordsReadContext } from './access.js';
import { asNationalId, type ListRosterRecordsQuery } from './list-query.js';
import type {
  RosterRecord,
  RosterRecordImport,
  RosterRecordListItem,
  RosterRecordPage,
} from './representation.js';

/** Imports listed on a record, newest first. */
const RECORD_HISTORY_LIMIT = 50;

/**
 * The national ID with all but its last three digits replaced, computed in the query so the
 * full value never leaves the database for a list.
 */
const maskedNationalId = sql<string>`repeat('•', greatest(length(${rosterRecords.nationalId}) - 3, 0)) || right(${rosterRecords.nationalId}, 3)`;

const listItemColumns = {
  id: rosterRecords.id,
  personnelFileNumber: rosterRecords.personnelFileNumber,
  fullName: rosterRecords.fullName,
  nationalIdMasked: maskedNationalId,
  designation: rosterRecords.designation,
  jobGroup: rosterRecords.jobGroup,
  reportingEntityId: reportingEntities.id,
  reportingEntityName: reportingEntities.name,
  state: rosterRecords.state,
  absentFromLatestImport: rosterRecords.absentFromLatestImport,
  flaggedByImportId: rosterRecords.flaggedByImportId,
  flaggedAt: rosterRecords.flaggedAt,
};

const recordColumns = {
  ...listItemColumns,
  nationalId: rosterRecords.nationalId,
  appointmentDate: rosterRecords.appointmentDate,
  email: rosterRecords.email,
  phone: rosterRecords.phone,
  exitDate: rosterRecords.exitDate,
  source: rosterRecords.source,
  firstSeenImportId: rosterRecords.firstSeenImportId,
  lastSeenImportId: rosterRecords.lastSeenImportId,
  createdAt: rosterRecords.createdAt,
  updatedAt: rosterRecords.updatedAt,
};

/**
 * Reading a Commission's roster (spec #27): its records, searched and filtered, one record with
 * its import history, and its summary. Records are for the Commission's reporting officer and
 * commission admin and for platform admins; the summary also for EACC and the Commission's HR
 * system. Anything outside the caller's view is 404.
 */
@Injectable()
export class RosterRecordsService {
  constructor(@InjectDatabase() private readonly db: Database<DirectorySchema>) {}

  /**
   * One page of records ordered by full name, in one query. An empty page is checked against
   * the Commission, so a Commission that does not exist is 404 rather than an empty roster.
   */
  async list(
    principal: Principal,
    slug: string,
    query: ListRosterRecordsQuery,
  ): Promise<RosterRecordPage> {
    const context = recordsReadContext(principal, slug);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (after === null) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: [{ path: 'cursor', message: 'Unknown cursor; start again from the first page' }],
      });
    }

    return withTenant(this.db, context, async (tx) => {
      const rows = await tx
        .select(listItemColumns)
        .from(rosterRecords)
        .leftJoin(reportingEntities, eq(reportingEntities.id, rosterRecords.reportingEntityId))
        .where(
          and(
            eq(rosterRecords.tenant, slug),
            ...filtersFor(query),
            after
              ? sql`(${rosterRecords.fullName}, ${rosterRecords.id}) > (${after.name}, ${after.id})`
              : undefined,
          ),
        )
        .orderBy(asc(rosterRecords.fullName), asc(rosterRecords.id))
        .limit(query.limit + 1);
      if (rows.length === 0) await requireCommission(tx, slug);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toListItem),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ name: last.fullName, id: last.id })
            : null,
      };
    });
  }

  /** One record in full, with the imports that had a row for it. */
  async get(principal: Principal, slug: string, recordId: string): Promise<RosterRecord> {
    const context = recordsReadContext(principal, slug);
    return withTenant(this.db, context, async (tx) => {
      const [row] = await tx
        .select(recordColumns)
        .from(rosterRecords)
        .leftJoin(reportingEntities, eq(reportingEntities.id, rosterRecords.reportingEntityId))
        .where(and(eq(rosterRecords.id, recordId), eq(rosterRecords.tenant, slug)));
      const record = notFoundIfInvisible(row);
      const imports = await tx
        .select({
          importId: rosterImports.id,
          startedAt: rosterImports.startedAt,
          status: rosterImportRows.status,
          outcome: rosterImportRows.outcome,
        })
        .from(rosterImportRows)
        .innerJoin(rosterImports, eq(rosterImports.id, rosterImportRows.importId))
        .where(
          and(
            eq(rosterImportRows.recordId, recordId),
            or(isNotNull(rosterImportRows.outcome), eq(rosterImportRows.status, 'rejected')),
          ),
        )
        .orderBy(desc(rosterImports.startedAt), desc(rosterImports.id))
        .limit(RECORD_HISTORY_LIMIT);

      return {
        ...toListItem(record),
        nationalId: record.nationalId,
        appointmentDate: record.appointmentDate,
        email: record.email,
        phone: record.phone,
        exitDate: record.exitDate,
        source: record.source,
        firstSeenImportId: record.firstSeenImportId,
        lastSeenImportId: record.lastSeenImportId,
        imports: imports.map((entry): RosterRecordImport => ({
          importId: entry.importId,
          startedAt: entry.startedAt.toISOString(),
          outcome: entry.status === 'rejected' ? 'rejected' : (entry.outcome ?? 'unchanged'),
        })),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    });
  }

  /** The Commission's roster summary, for its own staff and HR system and national readers. */
  async summary(principal: Principal, slug: string): Promise<RosterSummary> {
    notFoundIfInvisible(slug, () => canSeeCommission(principal, slug));
    const [row] = await withTenant(this.db, tenantContextOf(principal), (tx) =>
      tx
        .select({ slug: commissions.slug, roster: rosterSummaryColumns })
        .from(commissions)
        .leftJoin(rosterSummaries, eq(rosterSummaries.tenant, commissions.slug))
        .where(eq(commissions.slug, slug)),
    );
    return toRosterSummary(notFoundIfInvisible(row).roster);
  }
}

/** Search (file number prefix, name fragment or full national ID), state and flag filters. */
function filtersFor(query: ListRosterRecordsQuery): (SQL | undefined)[] {
  const filters: (SQL | undefined)[] = [];
  if (query.search) {
    const escaped = query.search.replace(/[\\%_]/g, (char) => `\\${char}`);
    const nationalId = asNationalId(query.search);
    filters.push(
      or(
        like(sql`lower(${rosterRecords.personnelFileNumber})`, `${escaped.toLowerCase()}%`),
        ilike(rosterRecords.fullName, `%${escaped}%`),
        nationalId === undefined ? undefined : eq(rosterRecords.nationalId, nationalId),
      ),
    );
  }
  if (query.state) filters.push(eq(rosterRecords.state, query.state));
  if (query.flagged !== undefined) {
    filters.push(eq(rosterRecords.absentFromLatestImport, query.flagged));
  }
  return filters;
}

async function requireCommission(tx: Transaction, slug: string): Promise<void> {
  const [commission] = await tx
    .select({ slug: commissions.slug })
    .from(commissions)
    .where(eq(commissions.slug, slug));
  notFoundIfInvisible(commission);
}

interface ListItemRow {
  id: string;
  personnelFileNumber: string;
  fullName: string;
  nationalIdMasked: string;
  designation: string | null;
  jobGroup: string | null;
  reportingEntityId: string | null;
  reportingEntityName: string | null;
  state: RosterRecordState;
  absentFromLatestImport: boolean;
  flaggedByImportId: string | null;
  flaggedAt: Date | null;
}

function toListItem(row: ListItemRow): RosterRecordListItem {
  return {
    id: row.id,
    personnelFileNumber: row.personnelFileNumber,
    fullName: row.fullName,
    nationalIdMasked: row.nationalIdMasked,
    designation: row.designation,
    jobGroup: row.jobGroup,
    reportingEntity:
      row.reportingEntityId === null || row.reportingEntityName === null
        ? null
        : { id: row.reportingEntityId, name: row.reportingEntityName },
    state: row.state,
    absentFromLatestImport: row.absentFromLatestImport,
    flaggedByImportId: row.flaggedByImportId,
    flaggedAt: row.flaggedAt?.toISOString() ?? null,
  };
}
