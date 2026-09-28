import type { NewEvent } from '@adili/events';

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

export function rosterImportCompleted(
  slug: string,
  data: RosterImportCompletedData,
): NewEvent<RosterImportCompletedData> {
  return { type: ROSTER_IMPORT_COMPLETED, subject: data.importId, tenant: slug, data };
}

export const ROSTER_IMPORT_FAILED = 'roster.import.failed.v1';

export interface RosterImportFailedData extends Record<string, unknown> {
  importId: string;
  failureCode: ImportFailureCode;
  actor: EventActor;
}

export function rosterImportFailed(
  slug: string,
  data: RosterImportFailedData,
): NewEvent<RosterImportFailedData> {
  return { type: ROSTER_IMPORT_FAILED, subject: data.importId, tenant: slug, data };
}
