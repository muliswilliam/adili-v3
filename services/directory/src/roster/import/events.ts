import { tenantEvent } from '../../tenant-event.js';
import type { EventActor } from '../actor.js';
import type { ImportChannel } from '../schema.js';
import type { ImportCounts, ImportFailureCode } from './representation.js';

/**
 * Events about roster imports (spec #27). Ids and counts only, no personal data: consumers pull
 * the affected records through the API by import id. The `tenant` extension is the Commission's
 * slug; the subject is the import; `actor` is who started it (a user, or an HR system's client).
 */

export const ROSTER_IMPORT_COMPLETED = 'roster.import.completed.v1';

export interface RosterImportCompletedData extends Record<string, unknown> {
  importId: string;
  channel: ImportChannel;
  declaredComplete: boolean;
  counts: ImportCounts;
  actor: EventActor;
}

export const rosterImportCompleted = tenantEvent<RosterImportCompletedData>(
  ROSTER_IMPORT_COMPLETED,
  (data) => data.importId,
);

export const ROSTER_IMPORT_FAILED = 'roster.import.failed.v1';

export interface RosterImportFailedData extends Record<string, unknown> {
  importId: string;
  failureCode: ImportFailureCode;
  actor: EventActor;
}

export const rosterImportFailed = tenantEvent<RosterImportFailedData>(
  ROSTER_IMPORT_FAILED,
  (data) => data.importId,
);
