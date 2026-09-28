import type { NewEvent } from '@adili/events';

import type { EventActor } from '../actor.js';

/**
 * Events about exits and flags on a roster (spec #27), recorded in the transaction of the change
 * (they are also its audit record, ADR-008). Ids and counts only, no personal data. The `tenant`
 * extension is the Commission's slug.
 */

/** Where an exit was recorded: the console (reporting officer) or an HR system's API call. */
export type ExitSource = 'console' | 'api';

export const ROSTER_EXITS_CONFIRMED = 'roster.exits.confirmed.v1';

export interface RosterExitsConfirmedData extends Record<string, unknown> {
  batchId: string;
  count: number;
  source: ExitSource;
  /** The records now exited. */
  recordIds: string[];
  actor: EventActor;
}

/** Records were exited together; the subject is the batch. */
export function rosterExitsConfirmed(
  slug: string,
  data: RosterExitsConfirmedData,
): NewEvent<RosterExitsConfirmedData> {
  return { type: ROSTER_EXITS_CONFIRMED, subject: data.batchId, tenant: slug, data };
}

export const ROSTER_RECORDS_KEPT = 'roster.records.kept.v1';

export interface RosterRecordsKeptData extends Record<string, unknown> {
  count: number;
  /** The records whose absent flag was cleared. */
  recordIds: string[];
  actor: EventActor;
}

/** Flagged records were kept (their officers are still employed); the subject is the Commission. */
export function rosterRecordsKept(
  slug: string,
  data: RosterRecordsKeptData,
): NewEvent<RosterRecordsKeptData> {
  return { type: ROSTER_RECORDS_KEPT, subject: slug, tenant: slug, data };
}
