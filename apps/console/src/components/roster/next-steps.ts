import type { RosterImport } from '../../server/directory/client';
import type { CredentialState } from './api-credential';
import { rowsPurged } from './import-report';

export type NextStep =
  | { kind: 'review-flagged'; count: number }
  /** The rejected rows of the latest import, a file: fix them and import it again. */
  | { kind: 'fix-rejected'; importId: string; count: number; startedAt: string }
  | { kind: 'connect-hr' }
  | { kind: 'find-someone' };

/**
 * The overview's "Next steps", most pressing first: flagged officers to review, then (for the
 * reporting officer) the rejected rows of the latest import when it was a file whose rows can
 * still be read, and connecting the HR system while no credential is active. When nothing is
 * pending, a way to find someone on the roster. An HR system's rejected rows are fixed there.
 */
export function nextSteps({
  flagged,
  readOnly,
  credential,
  lastImport = null,
  now = new Date(),
}: {
  flagged: number;
  readOnly: boolean;
  /** The HR-system credential's state; null when unknown (not loaded, or not the officer's). */
  credential: CredentialState | null;
  /** The latest completed import; null when unknown or none. */
  lastImport?: RosterImport | null;
  now?: Date;
}): NextStep[] {
  const steps: NextStep[] = [];
  if (flagged > 0) steps.push({ kind: 'review-flagged', count: flagged });
  const rejected = lastImport?.counts?.rejected ?? 0;
  if (
    !readOnly &&
    lastImport?.channel === 'file' &&
    lastImport.state === 'completed' &&
    rejected > 0 &&
    !rowsPurged(lastImport, now)
  ) {
    steps.push({
      kind: 'fix-rejected',
      importId: lastImport.id,
      count: rejected,
      startedAt: lastImport.startedAt,
    });
  }
  const hrConnected = credential === null || credential === 'active';
  if (!readOnly && !hrConnected) steps.push({ kind: 'connect-hr' });
  if (steps.length === 0) steps.push({ kind: 'find-someone' });
  return steps;
}
