import type { FormMV1, FormValidationError } from '@adili/forms';

import { FIRST_FINANCIAL_YEAR, periodOf, previewFromOf } from '../financial-year.js';
import type { ReportCounts } from './schema.js';

/**
 * Federated submission (spec 09): a Commission running its own system files the same `form-m.v1`
 * document a hosted Commission confirms. The schema says what a document looks like; these are
 * the rules it cannot say, checked once the document is valid against it. Pure functions.
 */

/** The OAuth scope a federated Commission's API client submits Form M with. */
export const REPORTS_SUBMIT_SCOPE = 'reports:submit';

const SECTIONS = ['initial', 'biennial', 'final'] as const;

/**
 * What the valid `document` breaks of the business rules on `today` (a Nairobi date), by dotted
 * path, as the schema's problems are:
 *
 * - the period is the financial year it names (1 July to 30 June), a year reports exist for and
 *   whose reports are open (from 1 April of its last half, as a hosted preview);
 * - per declaration section, declared and not declared add up to expected, and the non-filers
 *   listed are as many as not declared; a year without a biennial cycle expects none;
 * - access requests granted and declined are no more than received, and the decline reasons
 *   add up to declined;
 * - Part III names who compiled and who confirmed the report, with the dates.
 */
export function federatedRuleProblems(document: FormMV1, today: string): FormValidationError[] {
  const problems: FormValidationError[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });

  const { period } = document.partI;
  const fy = period.financialYearStart;
  const expected = periodOf(fy);
  if (period.from !== expected.from) {
    problem(
      'partI.period.from',
      `must be ${expected.from}, the start of financial year ${String(fy)}`,
    );
  }
  if (period.to !== expected.to) {
    problem('partI.period.to', `must be ${expected.to}, the end of financial year ${String(fy)}`);
  }
  if (fy < FIRST_FINANCIAL_YEAR) {
    problem(
      'partI.period.financialYearStart',
      `reports exist from financial year ${String(FIRST_FINANCIAL_YEAR)}`,
    );
  } else if (today < previewFromOf(fy)) {
    problem(
      'partI.period.financialYearStart',
      `reports for financial year ${String(fy)} open on ${previewFromOf(fy)}`,
    );
  }

  for (const key of SECTIONS) {
    const section = document.partII[key];
    const at = `partII.${key}`;
    if (section.declared + section.notDeclared !== section.expected) {
      problem(`${at}.declared`, 'declared and notDeclared must add up to expected');
    }
    if (section.nonFilers.length !== section.notDeclared) {
      problem(
        `${at}.nonFilers`,
        `lists ${String(section.nonFilers.length)} officers; notDeclared is ${String(section.notDeclared)}`,
      );
    }
  }
  if (document.partII.biennial.noCycleInPeriod === true && document.partII.biennial.expected > 0) {
    problem('partII.biennial.expected', 'must be 0 in a year without a biennial cycle');
  }

  const access = document.partII.accessRequests;
  if (access.granted + access.declined > access.received) {
    problem('partII.accessRequests.received', 'must be at least granted plus declined');
  }
  const reasons = access.declineReasons.reduce((sum, { count }) => sum + count, 0);
  if (reasons !== access.declined) {
    problem('partII.accessRequests.declineReasons', 'the counts must add up to declined');
  }

  for (const role of ['compiledBy', 'confirmedBy'] as const) {
    const signatory = document.partIII[role];
    for (const field of ['name', 'date'] as const) {
      if (!signatory[field]?.trim()) problem(`partIII.${role}.${field}`, 'is required');
    }
  }
  return problems;
}

/** The headline counts of a filed document, kept in clear for lists and the EACC intake. */
export function reportCountsOf(document: FormMV1): ReportCounts {
  const counts = (key: (typeof SECTIONS)[number]) => {
    const { expected, declared, notDeclared } = document.partII[key];
    return { expected, declared, notDeclared };
  };
  const { received, granted, declined } = document.partII.accessRequests;
  return {
    initial: counts('initial'),
    biennial: {
      ...counts('biennial'),
      noCycleInPeriod: document.partII.biennial.noCycleInPeriod === true,
    },
    final: counts('final'),
    clarifications: document.partII.clarifications.items.length,
    accessRequests: { received, granted, declined },
  };
}
