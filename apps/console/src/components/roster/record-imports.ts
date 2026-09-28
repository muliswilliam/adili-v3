import type { RosterRecord } from '../../server/directory/client';

type RecordImport = RosterRecord['imports'][number];

/**
 * The import with `importId` among those that touched the record, e.g. for "First seen" and
 * "Last seen"; null when the record names none or the history no longer holds it.
 */
export function recordImport(
  record: Pick<RosterRecord, 'imports'>,
  importId: string | null,
): RecordImport | null {
  if (!importId) return null;
  return record.imports.find((entry) => entry.importId === importId) ?? null;
}

/** Whether the record should show the "not in latest import" flag: exited officers never do. */
export function isFlagged(record: Pick<RosterRecord, 'absentFromLatestImport' | 'state'>): boolean {
  return record.absentFromLatestImport && record.state !== 'exited';
}
