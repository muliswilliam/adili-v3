import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import { type ComplianceCounts, emptyComplianceCounts } from '../../src/open-data/tables.js';
import { section } from '../support/receipts.js';

/**
 * FY 2027 open-data fixtures (spec 09b S4): four Commissions reported and one did not.
 *
 * - `psc` and `tsc` are large, but psc's final cell counts 4 officers.
 * - `nlc` counts 8 officers in initial and 5 in final, and had no biennial cycle (a structural
 *   zero, published); its 13 officers clear the threshold for its other counts.
 * - `wrc` counts 5 officers in all: every figure of it is suppressed.
 * - `jsc` has not reported: its rows have no figures.
 */
export const RELEASE_FY = 2027;

export const RELEASE_COUNTS: Record<string, ReportCounts> = {
  psc: {
    initial: section(12, 10),
    biennial: { ...section(100, 95), noCycleInPeriod: false },
    final: section(4, 4),
    clarifications: 6,
    accessRequests: { received: 3, granted: 2, declined: 1 },
  },
  tsc: {
    initial: section(20, 20),
    biennial: { ...section(200, 150), noCycleInPeriod: false },
    final: section(15, 12),
    clarifications: 3,
    accessRequests: { received: 1, granted: 1, declined: 0 },
  },
  nlc: {
    initial: section(8, 7),
    biennial: { ...section(0, 0), noCycleInPeriod: true },
    final: section(5, 5),
    clarifications: 2,
    accessRequests: { received: 0, granted: 0, declined: 0 },
  },
  wrc: {
    initial: section(3, 3),
    biennial: { ...section(0, 0), noCycleInPeriod: true },
    final: section(2, 1),
    clarifications: 1,
    accessRequests: { received: 1, granted: 0, declined: 1 },
  },
};

/** The Commissions the directory lists: the four that reported, and `jsc`. */
export const RELEASE_COMMISSIONS = ['jsc', 'nlc', 'psc', 'tsc', 'wrc'];

function counts(overrides: {
  compliant?: number;
  nonCompliant?: number;
  furtherAction?: number;
  resolved?: number;
  notices?: number;
  warnings?: number;
  stoppages?: number;
  referrals?: number;
}): ComplianceCounts {
  const empty = emptyComplianceCounts();
  return {
    determinations: {
      compliant: overrides.compliant ?? 0,
      'non-compliant': overrides.nonCompliant ?? 0,
      'further-action': overrides.furtherAction ?? 0,
    },
    clarificationsResolved: overrides.resolved ?? 0,
    actions: {
      ...empty.actions,
      'notice-to-comply': overrides.notices ?? 0,
      warning: overrides.warnings ?? 0,
      'salary-stoppage': overrides.stoppages ?? 0,
    },
    referrals: overrides.referrals ?? 0,
  };
}

/** The projection facts' counts for the year, as the integration suite projects them. */
export const RELEASE_COMPLIANCE: Record<string, ComplianceCounts> = {
  psc: counts({
    compliant: 2,
    nonCompliant: 1,
    resolved: 1,
    notices: 2,
    warnings: 1,
    referrals: 1,
  }),
  tsc: counts({ compliant: 1, furtherAction: 1, notices: 1 }),
  nlc: counts({ nonCompliant: 1, resolved: 1 }),
  wrc: counts({ compliant: 1, notices: 1, stoppages: 1 }),
  // jsc's facts count nowhere: it has not reported.
  jsc: counts({ compliant: 4 }),
};
