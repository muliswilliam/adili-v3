import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';

import type { DirectorySchema } from '../../db/schema.js';
import { rosterActorOf } from '../actor.js';
import { confirmExits, keepRecords, RosterRecordsExited, RosterRecordsNotFound } from './exits.js';
import type {
  ConfirmExitsBody,
  ExitsResult,
  KeepResult,
  KeepRosterRecordsBody,
} from './representation.js';

/**
 * The reporting officer resolving flagged records (spec #27): confirming exits, or keeping
 * records whose officers are still employed. Their own Commission only; 404 for others.
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
