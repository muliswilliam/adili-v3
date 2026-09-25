/**
 * Copy for the Commissions workspace (spec 01, frontend). English only for now; Swahili slots
 * follow once the app-wide message convention lands.
 */
export const messages = {
  title: 'Commissions',
  count: (count: number, hasMore: boolean) =>
    hasMore ? `${count}+ Commissions` : `${count} ${count === 1 ? 'Commission' : 'Commissions'}`,
  allCommissions: 'All Commissions',

  filters: {
    search: 'Search',
    searchPlaceholder: 'Name or key',
    type: 'Type',
    reportingOfficer: 'Reporting officer',
    any: 'Any',
    clear: 'Clear filters',
  },

  table: {
    caption: 'Responsible Commissions',
    commission: 'Commission',
    type: 'Type',
    categories: 'Categories',
    reportingOfficer: 'Reporting officer',
    roster: 'Roster',
    created: 'Created',
    loadMore: 'Load more',
    loadingMore: 'Loading…',
    loadMoreFailed: 'More Commissions could not be loaded. Try again.',
  },

  type: { hosted: 'Hosted', federated: 'Federated' },
  officerState: { none: 'Not assigned', invited: 'Invited', activated: 'Activated' },
  categoriesNone: 'None',
  rosterNone: 'No roster yet',
  rosterOnboarded: (onboarded: number, expected: number) => `${onboarded} of ${expected} onboarded`,

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
    detailFallback: 'The directory service did not respond.',
    retry: 'Try again',
  },
  forbidden: 'You do not have access to Commissions.',

  detail: {
    loadError: 'This Commission could not be loaded',
    notFoundTitle: 'Commission not found',
    notFoundText: 'It may have been removed, or you may not have access to it.',
    details: 'Details',
    name: 'Name',
    key: 'Commission key',
    issuerCode: 'Issuer code',
    type: 'Type',
    categories: 'Categories',
    policyVersion: 'Policy version',
    policyVersionValue: (version: number) =>
      version === 1 ? 'Version 1, platform defaults' : `Version ${version}`,
    created: 'Created',
    roster: 'Roster',
    rosterEmptyTitle: 'No roster yet',
    rosterEmptyText: 'The reporting officer imports the roster after activating their account.',
  },
} as const;
