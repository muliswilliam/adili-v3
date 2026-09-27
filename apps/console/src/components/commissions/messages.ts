import type { DirectoryFailure } from '../../server/directory/result';
import type { CommissionType, ReportingOfficerFilter } from '../../server/directory/types';
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
   * The count line, "N Commissions", filtered or not. The directory returns no total, so while
   * more pages remain it counts the rows up to this page with a "+".
   */
  count: (count: number, { more }: { more: boolean }) => {
    const text = plural(count, 'Commission', 'Commissions');
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
  },

  pager: {
    label: 'Pagination',
    range: (from: number, to: number) =>
      `Showing ${formatNumber(from)}-${formatNumber(to)} Commissions`,
    /** A page opened from a shared link, whose place in the list is unknown. */
    rows: (count: number) => `Showing ${plural(count, 'Commission', 'Commissions')}`,
    previous: 'Previous page',
    next: 'Next page',
  },

  type: { hosted: 'Hosted', federated: 'Federated' } satisfies Record<CommissionType, string>,
  typeLong: {
    hosted: 'Hosted on Adili',
    federated: 'Federated (runs its own system)',
  } satisfies Record<CommissionType, string>,
  officerState: {
    none: 'Not assigned',
    invited: 'Invited',
    activated: 'Activated',
  } satisfies Record<ReportingOfficerFilter, string>,
  officerNone: 'Reporting officer not assigned',
  categoriesNone: 'None recorded',
  categoriesMore: (citations: readonly string[]) =>
    `${formatNumber(citations.length)} more: ${citations.join(', ')}`,
  rosterNone: 'No roster yet',

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
    retry: 'Try again',
  },
  /** For a 403 from the directory; users without the workspace get "No staff roles" instead. */
  forbidden: 'You do not have access to Commissions.',

  detail: {
    loading: 'Loading…',
    loadError: 'This Commission could not be loaded',
    name: 'Name',
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
      version === 1 ? 'Version 1, platform defaults' : `Version ${formatNumber(version)}`,
    created: 'Created',
    roster: 'Roster',
    rosterEmptyTitle: 'No roster yet',
    rosterEmptyText: 'The reporting officer imports the roster after activating their account.',
  },
} as const;

const FAILURE_TEXT = {
  unavailable: 'The directory service did not respond.',
  invalid: 'The directory service could not handle the request.',
  conflict: 'The directory service reported a conflict with the current data.',
  forbidden: messages.forbidden,
  'not-found': 'The directory service could not find what was asked for.',
  unauthenticated: 'Your session has ended. Sign in again.',
} satisfies Record<DirectoryFailure['kind'], string>;

/** What went wrong: the directory's own explanation when it gave one, else a generic line. */
export function failureText(failure: DirectoryFailure): string {
  const detail = 'problem' in failure ? failure.problem?.detail?.trim() : undefined;
  if (detail) return detail;
  return FAILURE_TEXT[failure.kind];
}
