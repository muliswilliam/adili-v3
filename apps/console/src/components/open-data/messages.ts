import type { Cycle, NationalMeasure, OpenDataTableKey } from '../../server/open-data-tables';
import { formatNumber } from '../format';

/** "2025/2026": the financial year by its start year. */
const fyLabel = (fy: number) => `${String(fy)}/${String(fy + 1)}`;

/**
 * Copy of EACC's open-data releases (spec 09b FE-3, #350), as the 12-open-data prototype words
 * it. One English string per key; the Swahili slot stays empty until translations are reviewed.
 */
export const en = {
  title: 'Open data',
  publicPage: 'Public page',
  buildSnapshot: 'Build snapshot',
  noAccess: 'This page is for EACC analysts and supervisors.',
  backToOverview: 'Go to overview',

  // Releases list
  listCaption: 'Open-data releases',
  columnYear: 'Financial year',
  columnKind: 'Kind',
  columnVersion: 'Version',
  columnStatus: 'Status',
  columnPublished: 'Published',
  year: (fy: number) => `FY ${fyLabel(fy)}`,
  kind: { annual: 'Annual', snapshot: 'Snapshot' } as const,
  version: (version: number) => `v${String(version)}`,
  notPublished: 'Not published',
  builtOn: (at: string) => `Built ${at}`,
  withdrawnOn: (on: string) => `Withdrawn ${on}`,
  openRelease: (title: string) => `Open ${title}`,
  emptyTitle: 'No releases yet',
  emptyText: 'The annual release publishes when the national report is approved.',
  loadErrorTitle: 'We could not load releases',
  loadErrorDetail: 'Check your connection and try again.',
  tryAgain: 'Try again',
  pagination: 'Releases pages',
  pageRange: (from: number, to: number, total: number) =>
    `${formatNumber(from)}-${formatNumber(to)} of ${formatNumber(total)}`,
  pageRows: (count: number) => `${formatNumber(count)} releases`,
  previousPage: 'Previous page',
  nextPage: 'Next page',

  // Build
  buildTitle: (fy: number) => `Build FY ${fyLabel(fy)} snapshot`,
  buildText: "Builds the six tables from today's figures with suppression applied.",
  buildPreviewOnly: 'Preview only. Nothing is public until a supervisor publishes.',
  cancel: 'Cancel',
  build: 'Build',
  building: (fy: number) => `Building FY ${fyLabel(fy)} snapshot…`,
  buildSteps: ['Building tables', 'Applying suppression', 'Reconciling totals', 'Writing files'],
  buildStopped: 'Snapshot build stopped.',
  reconciliationFailed: (totals: string) =>
    `National totals did not match their source (${totals}). Nothing was written.`,
  buildFailed: 'The snapshot could not be built. Nothing was written.',
  fyNotStarted: 'The financial year has not started yet.',
  storageUnavailable: 'File storage could not be reached. Nothing was written.',
  directoryUnavailable:
    'The directory could not be reached to count Commissions. Nothing was written.',
  dismiss: 'Dismiss',

  // Release page
  releaseTitle: (fy: number, kind: 'annual' | 'snapshot') =>
    `FY ${fyLabel(fy)} ${kind === 'annual' ? 'annual' : 'snapshot'}`,
  releaseCrumb: (fy: number, kind: 'annual' | 'snapshot', version: number) =>
    `FY ${fyLabel(fy)} ${kind} v${String(version)}`,
  release: 'Release',
  versionTag: (version: number) => `Version ${String(version)}`,
  builtBy: (at: string, name: string | null) => `Built ${at}${name ? ` by ${name}` : ''}`,
  publishedOn: (at: string, name: string | null) => `Published ${at}${name ? ` by ${name}` : ''}`,
  asAt: (on: string) => `As at ${on}`,
  notPublic: 'Not public. An EACC supervisor publishes it.',
  withdrawnBanner: (on: string, name: string | null) =>
    `Withdrawn ${on}${name ? ` by ${name}` : ''}.`,
  totalsMatch: 'Totals match',
  reconciledCounts: (filed: string, expected: string) => `: ${filed} of ${expected} declarations.`,
  sourceLive: 'the Form M projections at build',
  sourceNcrDraft: 'the national report as last built',
  releaseLoadErrorTitle: 'We could not load the release',
  releaseNotFound: 'This release does not exist.',
  backToReleases: 'Back to open data',

  tables: {
    'filing-by-commission': 'Declarations by Commission',
    'compliance-by-commission': 'Compliance by Commission',
    'by-entity-type': 'By reporting entity type',
    'by-cycle': 'By cycle',
    'access-requests': 'Access requests',
    'national-totals': 'National totals',
  } satisfies Record<OpenDataTableKey, string>,
  tablesLabel: 'Release tables',
  cycleLegend: 'Cycle',
  cycles: {
    initial: 'Initial',
    biennial: 'Biennial',
    final: 'Final',
    all: 'All cycles',
  } satisfies Record<Cycle, string>,
  sortBy: (column: string) => `${column}, sort`,

  columnCommission: 'Commission',
  columnEntityType: 'Reporting entity type',
  columnCycle: 'Cycle',
  columnExpected: 'Expected',
  columnDeclared: 'Declared',
  columnNotDeclared: 'Did not declare',
  columnRate: 'Rate',
  columnMeasure: 'Measure',
  columnValue: 'Value',
  groupDeterminations: 'Determinations',
  groupClarifications: 'Clarifications',
  groupActions: 'Administrative actions',
  columnCompliant: 'Compliant',
  columnNonCompliant: 'Non-compliant',
  columnFurtherAction: 'Further action',
  columnIssued: 'Issued',
  columnResolved: 'Resolved',
  columnNoticeToComply: 'Notice to comply',
  columnWarning: 'Warning',
  columnSalaryStoppage: 'Salary stoppage',
  columnDisciplinaryReferral: 'Disciplinary referral',
  columnReferrals: 'Referrals to EACC',
  columnReceived: 'Received',
  columnGranted: 'Granted',
  columnDeclined: 'Declined',
  noEntityTypes: 'No reporting entity types yet',
  noEntityTypesText: 'The directory does not group reporting entities by type yet.',
  notApplicable: 'n/a',

  measures: {
    commissions: 'Responsible Commissions',
    commissionsReported: 'Commissions reported',
    commissionsReportedOnTime: 'Reported on time',
    commissionsReportedLate: 'Reported late',
    commissionsNotReported: 'Not reported',
    reportingRate: 'Reporting rate',
    expected: 'Declarations expected',
    filed: 'Declarations made',
    nonFilers: 'Did not declare',
    filingRate: 'Declaration rate',
    clarificationsIssued: 'Clarifications issued',
    clarificationsResolved: 'Clarifications resolved',
    determinationsCompliant: 'Determinations: compliant',
    determinationsNonCompliant: 'Determinations: non-compliant',
    determinationsFurtherAction: 'Determinations: further action',
    actionsNoticeToComply: 'Notices to comply',
    actionsWarning: 'Warnings',
    actionsSalaryStoppage: 'Salary stoppages',
    actionsDisciplinaryReferral: 'Disciplinary referrals',
    referrals: 'Referrals to EACC',
    accessRequestsReceived: 'Access requests received',
    accessRequestsGranted: 'Access requests granted',
    accessRequestsDeclined: 'Access requests declined',
  } satisfies Record<NationalMeasure, string>,

  publishedOnApproval: (at: string) => `Published ${at} on NCR approval`,
  openVersion: (version: number) => `Open v${String(version)}`,

  // Publish, withdraw and rebuild (#353): EACC supervisors publish and withdraw.
  publish: 'Publish',
  publishTitle: (name: string) => `Publish ${name}?`,
  publishWarning: 'This will be public immediately.',
  publishConsequences: [
    'Anyone can view and download it on the open-data page and API.',
    'A manifest is issued as a Public verifiable document.',
    'It cannot be edited. To correct it, withdraw it and publish a new version.',
  ],
  publishing: 'Publishing…',
  publishingText: 'Issuing the manifest.',
  publishedToast: 'Published. It is public now.',
  publishForbidden: 'Only an EACC supervisor can publish a release.',
  notPreviewAnymore: 'This release is no longer a preview. The page shows it as it is now.',
  annualReleasePublished: (fy: number) =>
    `Another FY ${fyLabel(fy)} annual release is published. Withdraw it first, then publish this one.`,
  manifestRefused: 'The documents service refused the manifest. Nothing was published.',
  publishDocumentsUnavailable:
    'The documents service could not be reached. Nothing was published. Try again.',
  publishStorageUnavailable: 'File storage could not be reached. Nothing was published. Try again.',
  publishFailed: 'We could not confirm the publication. Try again: it will not be published twice.',

  withdraw: 'Withdraw',
  withdrawTitle: (name: string) => `Withdraw ${name}?`,
  withdrawConsequences: [
    'It stays online, marked withdrawn with your reason.',
    'Its files can still be downloaded.',
    'To correct it, build and publish a new version.',
  ],
  reason: 'Reason',
  reasonPlaceholder: 'What was wrong, and what the next version will change',
  reasonHint: (length: number) => `Shown publicly. ${formatNumber(length)}/1000`,
  reasonRequired: 'Enter a reason. It is shown publicly with the release.',
  reasonInvalid: 'Enter a reason of up to 1,000 characters.',
  withdrawing: 'Withdrawing…',
  withdrawnToast: 'Withdrawn. The reason is public.',
  withdrawForbidden: 'Only an EACC supervisor can withdraw a release.',
  notPublishedAnymore: 'This release is no longer published. The page shows it as it is now.',
  revocationRefused: 'The documents service refused to revoke the manifest. Nothing was withdrawn.',
  withdrawDocumentsUnavailable:
    'The documents service could not be reached. Nothing was withdrawn. Try again.',
  withdrawFailed: 'We could not confirm the withdrawal. Try again: it will not be withdrawn twice.',

  releaseGone: 'This release no longer exists.',
  stillProcessing: 'Your earlier request is still being processed. Try again in a moment.',
  earlierRequestRecorded:
    'Your earlier request was recorded. The page shows the release as it is now.',

  rebuild: (version: number) => `Build v${String(version)}`,
  rebuiltToast: (version: number) => `v${String(version)} built. Preview only.`,
  rebuildStopped: (version: number) => `v${String(version)} was not built.`,
  ncrNotBuilt: 'The national report for the year is not built yet. Nothing was written.',
  ncrNotApproved: 'The national report for the year is not approved yet. Nothing was written.',
  annualStillPublished:
    'An annual release of the year is still published. Withdraw it first. Nothing was written.',
  rebuildFailed: 'The release could not be built. Nothing was written.',

  // Version history (S7)
  versions: 'Versions',
  viewing: 'Viewing',
  versionsUnavailable: 'The version history could not be loaded.',
  eventWithdrawn: (at: string, name: string | null) =>
    `Withdrawn ${at}${name ? ` by ${name}` : ''}`,
  eventBuilt: (at: string, name: string | null) => `Built ${at}${name ? ` by ${name}` : ''}`,

  // Side cards
  manifest: 'Manifest',
  manifestPublic: 'Public',
  manifestPending: 'Issued as a Public verifiable document when published.',
  manifestQr: (code: string) => `QR code to verify release manifest ${code}`,
  verify: 'Verify',
  copy: 'Copy',
  copied: 'Copied',
  files: 'Files',
  fileRows: (rows: number) => `${formatNumber(rows)} rows`,
  fileHidden: (hidden: number) => `${formatNumber(hidden)} hidden`,
  fileHash: (sha: string) => `SHA-256 ${sha}`,

  // Reconciliation mismatches (`buildOpenDataRelease` 409 `mismatches`), by dot path.
  mismatch: {
    reporting: {
      commissions: 'Commissions',
      reported: 'Commissions reported',
      onTime: 'reported on time',
      late: 'reported late',
      notReported: 'not reported',
    },
    national: {
      expected: 'declarations expected',
      declared: 'declarations made',
      notDeclared: 'did not declare',
    },
    clarifications: 'clarifications issued',
    inCycle: (cycle: Cycle) => (cycle === 'all' ? 'in all cycles' : `in the ${cycle} cycle`),
  },
} as const;

export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;

/** The words for a reconciliation mismatch's dot path, e.g. `national.final.declared`. */
export function mismatchLabel(path: string): string {
  const [scope, part, figure] = path.split('.');
  const { reporting, national, inCycle } = en.mismatch;
  if (scope === 'reporting' && part && part in reporting) {
    return reporting[part as keyof typeof reporting];
  }
  if (scope === 'national' && part === 'clarifications') return en.mismatch.clarifications;
  if (scope === 'national' && part && figure && figure in national && part in en.cycles) {
    return `${national[figure as keyof typeof national]} ${inCycle(part as Cycle)}`;
  }
  return path;
}
