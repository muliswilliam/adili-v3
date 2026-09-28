import type { RosterSummary } from '../../server/directory/client';

/**
 * The onboarded share of expected declarants as a whole percentage, rounded down so the tile
 * never reads 100% while someone is still to onboard. 0 with nobody expected.
 */
export function onboardedPercent(onboarded: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.min(100, Math.floor((onboarded / expected) * 100));
}

/** Declarants still to onboard; never negative. */
export function toOnboard(
  roster: Pick<RosterSummary, 'expectedDeclarants' | 'onboardedDeclarants'>,
) {
  return Math.max(roster.expectedDeclarants - roster.onboardedDeclarants, 0);
}

export interface RosterCoverage {
  onboarded: number;
  expected: number;
  flagged: number;
  /** ISO date-time of the last import; null when none has finished yet. */
  lastImportAt: string | null;
}

/**
 * What the Commissions list says about a roster (spec 02 FE-9): nothing until one is imported,
 * then "{onboarded} of {expected} onboarded", the last import and any flagged officers.
 */
export function rosterCoverage(roster: RosterSummary): RosterCoverage | null {
  if (roster.status !== 'imported') return null;
  return {
    onboarded: roster.onboardedDeclarants,
    expected: roster.expectedDeclarants,
    flagged: roster.flagged,
    lastImportAt: roster.lastImportAt,
  };
}
