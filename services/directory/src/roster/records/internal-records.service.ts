import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, asc, eq, gt, isNotNull, type SQL } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { type DirectorySchema, persons } from '../../db/schema.js';
import { actingTenantContext } from '../../internal-api.js';
import {
  reportingEntities,
  rosterExits,
  rosterImportRows,
  rosterImports,
  rosterRecords,
} from '../schema.js';
import {
  decodePullCursor,
  encodePullCursor,
  type InternalListRosterRecordsQuery,
  type PullCursor,
} from './internal-query.js';
import type {
  InternalRosterRecord,
  InternalRosterRecordPage,
  RosterNationalId,
} from './representation.js';

const internalRecordColumns = {
  id: rosterRecords.id,
  tenant: rosterRecords.tenant,
  personnelFileNumber: rosterRecords.personnelFileNumber,
  fullName: rosterRecords.fullName,
  designation: rosterRecords.designation,
  jobGroup: rosterRecords.jobGroup,
  reportingEntityId: reportingEntities.id,
  reportingEntityName: reportingEntities.name,
  employerCode: rosterRecords.employerCode,
  state: rosterRecords.state,
  appointmentDate: rosterRecords.appointmentDate,
  exitDate: rosterRecords.exitDate,
  personId: rosterRecords.personId,
  ofr: persons.ofr,
  onboardedAt: rosterRecords.onboardedAt,
  updatedAt: rosterRecords.updatedAt,
};

/**
 * The roster records other services pull after a directory event (spec 04, ADR-013 local read
 * models): those an import had rows for, those an exit confirmation exited, or one record. The
 * callers are services acting for the Commission; another Commission's records, imports and
 * batches are 404.
 */
@Injectable()
export class InternalRosterRecordsService {
  constructor(@InjectDatabase() private readonly db: Database<DirectorySchema>) {}

  /**
   * One page of the records of an import (in row order) or of an exit batch (in id order), each
   * as it is now. 404 when the tenant has no such import or batch.
   */
  async list(
    principal: Principal,
    tenant: string,
    slug: string,
    query: InternalListRosterRecordsQuery,
  ): Promise<InternalRosterRecordPage> {
    const context = actingTenantContext(principal, tenant, slug);
    const kind = query.importId === undefined ? 'record' : 'row';
    const after = query.cursor === undefined ? undefined : decodePullCursor(query.cursor);
    if (after === null || (after && after.kind !== kind)) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: [{ path: 'cursor', message: 'Unknown cursor; start again from the first page' }],
      });
    }
    return withTenant(this.db, context, async (tx) => {
      const page =
        query.importId === undefined
          ? await exitBatchPage(tx, slug, query.exitBatchId ?? '', after, query.limit)
          : await importPage(tx, slug, query.importId, after, query.limit);
      return {
        items: page.rows.map(toInternalRecord),
        nextCursor: page.next ? encodePullCursor(page.next) : null,
      };
    });
  }

  /** One record of the tenant; 404 when it has none with this id. */
  async get(
    principal: Principal,
    tenant: string,
    slug: string,
    recordId: string,
  ): Promise<InternalRosterRecord> {
    const context = actingTenantContext(principal, tenant, slug);
    const [record] = await withTenant(this.db, context, (tx) =>
      selectRecords(tx).where(and(eq(rosterRecords.id, recordId), eq(rosterRecords.tenant, slug))),
    );
    return toInternalRecord(notFoundIfInvisible(record));
  }

  /** The national ID of one record of the tenant; 404 when it has none with this id. */
  async nationalId(
    principal: Principal,
    tenant: string,
    slug: string,
    recordId: string,
  ): Promise<RosterNationalId> {
    const context = actingTenantContext(principal, tenant, slug);
    const [record] = await withTenant(this.db, context, (tx) =>
      tx
        .select({ nationalId: rosterRecords.nationalId })
        .from(rosterRecords)
        .where(and(eq(rosterRecords.id, recordId), eq(rosterRecords.tenant, slug))),
    );
    return { nationalId: notFoundIfInvisible(record).nationalId };
  }
}

type RecordRow = Awaited<ReturnType<ReturnType<typeof selectRecords>['execute']>>[number];

interface Page {
  rows: RecordRow[];
  next: PullCursor | null;
}

function selectRecords(tx: Transaction) {
  return tx
    .select(internalRecordColumns)
    .from(rosterRecords)
    .leftJoin(reportingEntities, eq(reportingEntities.id, rosterRecords.reportingEntityId))
    .leftJoin(persons, eq(persons.id, rosterRecords.personId));
}

/**
 * The records the import had rows for (accepted and applied, or rejected against an existing
 * record), after the cursor's row. Walks the import's rows by their primary key.
 */
async function importPage(
  tx: Transaction,
  slug: string,
  importId: string,
  after: PullCursor | undefined,
  limit: number,
): Promise<Page> {
  const [found] = await tx
    .select({ id: rosterImports.id })
    .from(rosterImports)
    .where(and(eq(rosterImports.id, importId), eq(rosterImports.tenant, slug)));
  notFoundIfInvisible(found);
  const rows = await tx
    .select({ rowNumber: rosterImportRows.rowNumber, record: internalRecordColumns })
    .from(rosterImportRows)
    .innerJoin(rosterRecords, eq(rosterRecords.id, rosterImportRows.recordId))
    .leftJoin(reportingEntities, eq(reportingEntities.id, rosterRecords.reportingEntityId))
    .leftJoin(persons, eq(persons.id, rosterRecords.personId))
    .where(
      and(
        eq(rosterImportRows.importId, importId),
        isNotNull(rosterImportRows.recordId),
        after?.kind === 'row' ? gt(rosterImportRows.rowNumber, after.rowNumber) : undefined,
      ),
    )
    .orderBy(asc(rosterImportRows.rowNumber))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page.map((row) => row.record),
    next: rows.length > limit && last ? { kind: 'row', rowNumber: last.rowNumber } : null,
  };
}

/** The records the exit confirmation exited, after the cursor's record. */
async function exitBatchPage(
  tx: Transaction,
  slug: string,
  batchId: string,
  after: PullCursor | undefined,
  limit: number,
): Promise<Page> {
  const inBatch = (position?: SQL) =>
    and(eq(rosterExits.batchId, batchId), eq(rosterExits.tenant, slug), position);
  const rows = await selectRecords(tx)
    .innerJoin(rosterExits, eq(rosterExits.recordId, rosterRecords.id))
    .where(inBatch(after?.kind === 'record' ? gt(rosterExits.recordId, after.recordId) : undefined))
    .orderBy(asc(rosterExits.recordId))
    .limit(limit + 1);
  if (rows.length === 0) {
    // An empty page past the end of a batch, or no such batch.
    const [any] = await tx
      .select({ recordId: rosterExits.recordId })
      .from(rosterExits)
      .where(inBatch())
      .limit(1);
    notFoundIfInvisible(any);
  }
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page,
    next: rows.length > limit && last ? { kind: 'record', recordId: last.id } : null,
  };
}

function toInternalRecord(row: RecordRow): InternalRosterRecord {
  return {
    id: row.id,
    tenant: row.tenant,
    personnelFileNumber: row.personnelFileNumber,
    fullName: row.fullName,
    designation: row.designation,
    jobGroup: row.jobGroup,
    reportingEntity:
      row.reportingEntityId === null || row.reportingEntityName === null
        ? null
        : { id: row.reportingEntityId, name: row.reportingEntityName },
    employerCode: row.employerCode,
    state: row.state,
    appointmentDate: row.appointmentDate,
    exitDate: row.exitDate,
    personId: row.personId,
    ofr: row.ofr,
    onboardedAt: row.onboardedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
