import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';

import type { DirectorySchema } from '../../db/schema.js';
import { rosterActorOf } from '../actor.js';
import { readRosterRecord } from '../records/records.service.js';
import type { RosterRecord } from '../records/representation.js';
import {
  confirmExits,
  keepRecords,
  recordIdByFileNumber,
  RosterRecordsExited,
  RosterRecordsNotFound,
} from './exits.js';
import type {
  ConfirmExitsBody,
  ExitsResult,
  KeepResult,
  KeepRosterRecordsBody,
  RecordRosterExitBody,
} from './representation.js';

/**
 * Exits on a Commission's roster (spec #27): the reporting officer resolving flagged records
 * (confirming exits, or keeping records whose officers are still employed), and the HR system
 * recording an exit by personnel file number. Their own Commission only; 404 for others.
 */
@Injectable()
export class RosterExitsService {
  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
  ) {}

  /** Exits the records, each on its own date or the batch's. */
  async confirm(principal: Principal, slug: string, body: ConfirmExitsBody): Promise<ExitsResult> {
    notFoundIfInvisible(slug, () => principal.tenant === slug);
    const exits = body.records.map(({ recordId, exitDate }) => ({
      recordId,
      // The body schema requires the batch date whenever a record has none.
      exitDate: exitDate ?? body.exitDate ?? '',
    }));
    const paths = new Map(
      body.records.map(({ recordId }, index) => [recordId, `records.${index}.recordId`]),
    );
    try {
      return await withTenant(this.db, { tenant: slug, subject: principal.subject }, (tx) =>
        confirmExits(tx, this.events, {
          tenant: slug,
          exits,
          source: 'console',
          actor: rosterActorOf(principal),
        }),
      );
    } catch (error) {
      throw asProblem(error, paths);
    }
  }

  /**
   * Exits the record with this personnel file number, as the Commission's HR system records an
   * officer's departure (or its reporting officer, through the same API): like confirming the
   * exit of one record. 404 `record-not-found` when the roster has no such file number, 409
   * `record-exited` when it has exited already. Returns the record as it now is.
   */
  async recordExit(
    principal: Principal,
    slug: string,
    fileNumber: string,
    body: RecordRosterExitBody,
  ): Promise<RosterRecord> {
    notFoundIfInvisible(slug, () => principal.tenant === slug);
    const actor = rosterActorOf(principal);
    try {
      return await withTenant(this.db, { tenant: slug, subject: principal.subject }, async (tx) => {
        const recordId = await recordIdByFileNumber(tx, slug, fileNumber);
        if (recordId === undefined) throw new RosterRecordsNotFound([fileNumber]);
        await confirmExits(tx, this.events, {
          tenant: slug,
          exits: [{ recordId, exitDate: body.exitDate }],
          source: actor.kind === 'client' ? 'api' : 'console',
          actor,
        });
        const record = await readRosterRecord(tx, slug, recordId);
        if (!record) throw new Error(`Roster record ${recordId} vanished after its exit`);
        return record;
      });
    } catch (error) {
      if (error instanceof RosterRecordsNotFound) {
        throw new ProblemException({
          type: 'record-not-found',
          title: 'Record not found',
          status: HttpStatus.NOT_FOUND,
          detail: "No officer on this Commission's roster has that personnel file number.",
        });
      }
      if (error instanceof RosterRecordsExited) {
        throw new ProblemException({
          type: 'record-exited',
          title: 'Record already exited',
          status: HttpStatus.CONFLICT,
          detail: 'The officer with that personnel file number has exited already.',
        });
      }
      throw error;
    }
  }

  /** Clears the absent flag of the records. */
  async keep(principal: Principal, slug: string, body: KeepRosterRecordsBody): Promise<KeepResult> {
    notFoundIfInvisible(slug, () => principal.tenant === slug);
    const paths = new Map(
      body.recordIds.map((recordId, index) => [recordId, `recordIds.${index}`]),
    );
    try {
      return await withTenant(this.db, { tenant: slug, subject: principal.subject }, (tx) =>
        keepRecords(tx, this.events, {
          tenant: slug,
          recordIds: body.recordIds,
          actor: rosterActorOf(principal),
        }),
      );
    } catch (error) {
      throw asProblem(error, paths);
    }
  }
}

/**
 * Maps the domain's refusals to problems pointing at the offending records in the body, with
 * paths written like validation errors'.
 */
function asProblem(error: unknown, paths: Map<string, string>): unknown {
  const errors = (recordIds: readonly string[], message: string) =>
    recordIds.map((id) => ({ path: paths.get(id) ?? id, message }));
  if (error instanceof RosterRecordsNotFound) {
    return new ProblemException({
      type: 'record-not-found',
      title: 'Record not found',
      status: HttpStatus.NOT_FOUND,
      detail: "Some records are not on this Commission's roster, so nothing was changed.",
      errors: errors(error.recordIds, "Not on this Commission's roster"),
    });
  }
  if (error instanceof RosterRecordsExited) {
    return new ProblemException({
      type: 'record-exited',
      title: 'Record already exited',
      status: HttpStatus.CONFLICT,
      detail: 'Some records have exited already, so nothing was changed.',
      errors: errors(error.recordIds, 'Already exited'),
    });
  }
  return error;
}
