import { formatNumber } from './format';

const plural = (count: number, one: string, many: string) =>
  `${formatNumber(count)} ${count === 1 ? one : many}`;

/**
 * Copy for the Commissions workspace (spec 01, frontend), from the prototype
 * (`apps/console/prototype/01-commissions.prototype.html`). English only for now; Swahili slots
 * follow once the app-wide message convention lands.
 */
export const messages = {
  title: 'Commissions',
  /**
   * The count line. The directory returns no total, so while more pages remain it counts the rows
   * seen so far with a "+".
   */
  count: (count: number, { filtered, more }: { filtered: boolean; more: boolean }) => {
    const text = filtered
      ? plural(count, 'match', 'matches')
      : plural(count, 'Commission', 'Commissions');
    return more ? text.replace(' ', '+ ') : text;
  },
  readOnly: 'Read only',

  filters: {
    search: 'Search Commissions',
    searchPlaceholder: 'Search by name or key',
    type: 'Type',
    anyType: 'All types',
    reportingOfficer: 'Reporting officer',
    anyReportingOfficer: 'Any reporting officer',
    clear: 'Clear',
    clearAll: 'Clear filters',
  },

  table: {
    caption: 'Responsible Commissions',
    loadingCaption: 'Responsible Commissions (loading)',
    commission: 'Commission',
    type: 'Type',
    categories: 'Categories',
    reportingOfficer: 'Reporting officer',
    roster: 'Roster',
    created: 'Created',
    pageFailed: 'This page of Commissions could not be loaded. Try again.',
  },

  pager: {
    label: 'Pagination',
    range: (from: number, to: number) =>
      `Showing ${formatNumber(from)}-${formatNumber(to)} Commissions`,
    previous: 'Previous page',
    next: 'Next page',
  },

  type: { hosted: 'Hosted', federated: 'Federated' },
  typeLong: { hosted: 'Hosted on Adili', federated: 'Federated (runs its own system)' },
  officerState: { none: 'Not assigned', invited: 'Invited', activated: 'Activated' },
  officerNone: 'Reporting officer not assigned',
  categoriesNone: 'None recorded',
  categoriesMore: (citations: readonly string[]) =>
    `${formatNumber(citations.length)} more: ${citations.join(', ')}`,
  rosterNone: 'No roster yet',
  rosterOnboarded: (onboarded: number, expected: number) =>
    `${formatNumber(onboarded)} of ${formatNumber(expected)} onboarded`,
  rosterFlagged: (flagged: number) => `${formatNumber(flagged)} flagged`,

  empty: {
    title: 'No Commissions yet',
    text: 'Create the first Responsible Commission to start onboarding.',
  },
  noMatches: {
    title: 'No matches',
    text: 'Try a different search or clear the filters.',
  },
  error: {
    title: 'Commissions could not be loaded',
    text: 'The directory service did not respond.',
    retry: 'Try again',
  },
  forbidden: 'You do not have access to Commissions.',

  detail: {
    loading: 'Loading…',
    loadError: 'This Commission could not be loaded',
    notFoundCrumb: 'Not found',
    notFoundTitle: 'Commission not found',
    notFoundText: 'It does not exist or you do not have access to it.',
    back: 'Back to Commissions',
    details: 'Details',
    key: 'Commission key',
    issuerCode: 'Issuer code',
    issuerCodeExample: (code: string) => `e.g. DCB-${code}-2027-0012345-K`,
    type: 'Type',
    categories: 'Categories',
    policyVersion: 'Policy version',
    policyVersionValue: (version: number) =>
      version === 1
        ? 'Version 1, platform defaults'
        : `Version ${formatNumber(version)}, obligations start date changed`,
    created: 'Created',
    roster: 'Roster',
    rosterEmptyTitle: 'No roster yet',
    rosterEmptyText: 'The reporting officer imports the roster after activating their account.',
    expected: 'Expected declarants',
    onboarded: 'Onboarded',
    flagged: 'Flagged',
    lastImport: 'Last import',
  },
} as const;
