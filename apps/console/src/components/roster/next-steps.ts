import type { CredentialState } from './api-credential';

export type NextStep =
  { kind: 'review-flagged'; count: number } | { kind: 'connect-hr' } | { kind: 'find-someone' };

/**
 * The overview's "Next steps", most pressing first: flagged officers to review, then (for the
 * reporting officer) connecting the HR system while no credential is active. When nothing is
 * pending, a way to find someone on the roster.
 */
export function nextSteps({
  flagged,
  readOnly,
  credential,
}: {
  flagged: number;
  readOnly: boolean;
  /** The HR-system credential's state; null when unknown (not loaded, or not the officer's). */
  credential: CredentialState | null;
}): NextStep[] {
  const steps: NextStep[] = [];
  if (flagged > 0) steps.push({ kind: 'review-flagged', count: flagged });
  const hrConnected = credential === null || credential === 'active';
  if (!readOnly && !hrConnected) steps.push({ kind: 'connect-hr' });
  if (steps.length === 0) steps.push({ kind: 'find-someone' });
  return steps;
}
