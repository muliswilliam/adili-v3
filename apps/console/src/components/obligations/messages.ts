import { formatNumber } from '../format';

/**
 * Type labels, status words and reminder outcomes come from the table shared with the portal
 * (@adili/ui `lib/obligations`, spec 04 i18n); this file holds the console's own copy.
 */
/**
 * Copy of the Obligations workspace (spec 04 frontend, FE-3). One English string per key; the
 * Swahili slot stays empty until translations are reviewed by EACC.
 */
export const en = {
  title: 'Obligations',
  workspaceDescription: 'Who must declare, by when, and who has been reminded.',
  loading: 'Loading…',
  cycleLine: (cycle: string, statement: string, due: string) =>
    `${cycle} · statement ${statement} · due ${due}`,
  cycleNotOpen: 'Not open yet',
  cycleNotOpenHint: (opens: string) => `The cycle's obligations are created on ${opens}.`,
  // Tiles
  summaryLabel: 'Summary',
  byType: (label: string) => `${label} by type`,
  notOnboardedTile: 'Due or overdue but not onboarded',
  notOnboardedBreakdown: 'Not onboarded by status',
  // Callout
  notOnboardedCallout: (count: number) =>
    `${formatNumber(count)} ${count === 1 ? 'declarant' : 'declarants'} with a declaration due ${count === 1 ? 'has' : 'have'} not onboarded. They receive no reminders from Adili. Chase them through your own channels.`,
  viewRoster: 'View roster',
  showInList: 'Show in list',
  // Toolbar
  searchLabel: 'Search by file number or name',
  searchPlaceholder: 'File number or name',
  typeLabel: 'Type',
  typeAll: 'All types',
  statusLabel: 'Status',
  statusAll: 'All statuses',
  onboardedLabel: 'Onboarded',
  onboardedAny: 'Any',
  onboardedYes: 'Onboarded',
  onboardedNo: 'Not onboarded',
  cycleLabel: 'Cycle',
  cycleAll: 'All cycles',
  cycleNotOpenOption: (cycle: string) => `${cycle} (not open yet)`,
  clear: 'Clear',
  // Table
  caption: 'Declarants and their obligations, overdue first',
  loadingCaption: 'Obligations (loading)',
  columnDeclarant: 'Declarant',
  columnType: 'Type',
  columnStatementDate: 'Statement date',
  columnDueDate: 'Due date',
  columnStatus: 'Status',
  columnOnboarded: 'Onboarded',
  columnReminders: 'Reminders',
  yes: 'Yes',
  no: 'No',
  onboardedShort: 'Onboarded',
  notOnboardedShort: 'Not onboarded',
  remindersLast: (offset: string, outcome: string) => `Last (${offset}): ${outcome}`,
  remindersNoneNotOnboarded: 'None sent: not yet onboarded. Chase through your own channels.',
  remindersSeeHistory: 'Open the declarant for the reminder history.',
  shown: (count: number) =>
    `Showing ${formatNumber(count)} ${count === 1 ? 'obligation' : 'obligations'}`,
  allShown: (count: number) =>
    `All ${formatNumber(count)} ${count === 1 ? 'obligation' : 'obligations'} shown`,
  loadMore: 'Load more',
  loadingMore: 'Loading…',
  loadMoreError: 'More obligations could not be loaded. Try again.',
  // States
  emptyTitle: 'No obligations yet',
  emptyText: 'Obligations appear when the roster is imported and a cycle opens.',
  importRoster: 'Import roster',
  noMatchesTitle: 'No matches',
  noMatchesText: 'Try a different search or clear the filters.',
  clearFilters: 'Clear filters',
  errorTitle: 'Obligations could not be loaded',
  errorDetail: 'The declarations service did not respond. Try again in a moment.',
  tryAgain: 'Try again',
  forbidden: 'You can see counts on the Commission page, not the declarant list.',
  openCommissions: 'Open Commissions',
  backToCommission: 'Back to the Commission',
  pickCommission: "Open a Commission to see its declarants' obligations.",
  noAccess: 'You do not have access to Commission obligations.',
  backToOverview: 'Back to overview',
  notFoundTitle: 'Commission not found',
  notFoundText: 'It does not exist or you do not have access to it.',
  // Drawer
  fileNumber: 'File number',
  type: 'Type',
  commission: 'Commission',
  cycle: 'Cycle',
  statementDate: 'Statement date',
  statementDateHint: 'The date the financial position is declared as at.',
  dueDate: 'Due date',
  reminders: 'Reminders',
  reminderSchedule: (commission: string, version: number) =>
    `Reminder schedule set by ${commission} · policy v${formatNumber(version)}`,
  reminderScheduleNotOnboarded: 'none sent until onboarded',
  rosterRecord: 'Roster record',
  close: 'Close',
  detailErrorTitle: 'The obligation could not be loaded',
  detailNotFound: 'This obligation is no longer on record.',
  // Commission detail card (FE-4)
  cardCycle: (cycle: string, due: string) => `${cycle} · due ${due}`,
  cardNotOnboarded: 'Not onboarded',
  cardNotOnboardedHint: 'Due or overdue, not onboarded',
  cardError: 'Obligation counts could not be loaded. Reload the page to try again.',
  openObligations: 'Obligations',
  // National summary (FE-5)
  nationalTitle: 'National obligations',
  nationalDescription: 'Due and overdue counts per Commission.',
  nationalCycle: (cycle: string, due: string) => `${cycle} · due ${due}`,
  cycleNotOpenNotice: (cycle: string, opens: string) =>
    `${cycle} opens on ${opens}. Until then, counts cover initial and final declarations.`,
  nationalCaption: (cycle: string) => `Obligations per Commission, ${cycle}`,
  nationalLoadingCaption: 'Obligations per Commission (loading)',
  columnCommission: 'Commission',
  columnUpcoming: 'Upcoming',
  columnDue: 'Due',
  columnOverdue: 'Overdue',
  columnNotOnboarded: 'Not onboarded',
  columnNotOnboardedHint:
    'Declarants with a due or overdue declaration who have no Adili account yet',
  columnNotOnboardedHintLabel: 'About not onboarded',
  columnLastImport: 'Last roster import',
  sortLabel: 'Sort by',
  sortOption: {
    name: 'Name, A to Z',
    upcoming: 'Most upcoming',
    due: 'Most due',
    overdue: 'Most overdue',
    notOnboarded: 'Most not onboarded',
    lastImport: 'Latest roster import',
  },
  noRosterYet: 'No roster yet',
  nationalTotal: (count: number) =>
    `Total, ${formatNumber(count)} ${count === 1 ? 'Commission' : 'Commissions'}`,
  nationalPagination: 'Commission pages',
  nationalPageRange: (from: number, to: number, total: number) =>
    `${formatNumber(from)}-${formatNumber(to)} of ${formatNumber(total)}`,
  nationalPageRows: (count: number) =>
    `${formatNumber(count)} ${count === 1 ? 'Commission' : 'Commissions'}`,
  previousPage: 'Previous page',
  nextPage: 'Next page',
  nationalEmptyTitle: 'No Commission has obligations yet.',
  nationalEmptyText: 'Counts appear as rosters are imported.',
  nationalErrorTitle: 'National obligations could not be loaded',
  nationalErrorDetail: 'The declarations service did not respond. Try again in a moment.',
  nationalNoAccess: 'You do not have access to national obligations.',
  openOwnObligations: "Open your Commission's obligations",
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
