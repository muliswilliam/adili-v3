import { formatNumber } from '../format';

/**
 * Copy of the Roster workspace (spec 02 frontend). One English string per key; the Swahili slot
 * stays empty until translations are reviewed by EACC. Replace with the console-wide message
 * convention when it lands.
 */
export const en = {
  title: 'Roster',
  readOnly: 'Read only',
  loading: 'Loading…',
  // Overview
  noneTitle: 'No roster yet',
  noneText:
    "Import your Commission's declarant roster to start onboarding. Download the template, fill it from your HR extract, upload it here.",
  noneTextReadOnly: 'Your reporting officer has not imported it yet.',
  downloadTemplate: 'Download template',
  templateCsv: 'CSV template (.csv)',
  templateXlsx: 'Excel template (.xlsx)',
  templateError: 'The template could not be downloaded. Try again.',
  importRoster: 'Import roster',
  importNotYet: 'Roster import is not available yet.',
  summaryCards: 'Roster summary',
  expectedDeclarants: 'Expected declarants',
  onboarded: 'Onboarded',
  onboardedShare: (percent: number) => `${formatNumber(percent)}%`,
  toGo: (count: number) => `${formatNumber(count)} to go`,
  flagged: 'Flagged as absent',
  errorTitle: 'Roster could not be loaded',
  errorDetail: 'Check your connection and try again.',
  tryAgain: 'Retry',
  // No workspace
  forbidden: 'You do not have access to the roster.',
  backToOverview: 'Back to overview',
  nationalTitle: 'Rosters belong to each Commission',
  nationalText: "See coverage and import history on each Commission's page.",
  nationalAction: 'Commissions',
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
