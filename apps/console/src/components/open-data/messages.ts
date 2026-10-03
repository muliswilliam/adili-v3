import type { Cycle, NationalMeasure } from '../../server/open-data-tables';
import type { OpenDataTableKey } from '../../server/open-data-tables';
import { formatNumber } from '../format';
import { fyLabel } from '../national-report/model';

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
} as const;

export const sw: Partial<typeof en> = {};

export const messages = en;

/** The words for a reconciliation mismatch's dot path, e.g. `national.final.declared`. */
export function mismatchLabel(path: string): string {
  const [scope, part, figure] = path.split('.');
  if (scope === 'reporting' && part) {
    const reporting: Record<string, string> = {
      commissions: 'Commissions',
      reported: 'Commissions reported',
      onTime: 'reported on time',
      late: 'reported late',
      notReported: 'not reported',
    };
    return reporting[part] ?? path;
  }
  if (scope === 'national' && part === 'clarifications') return 'clarifications issued';
  if (scope === 'national' && part && figure) {
    const figures: Record<string, string> = {
      expected: 'declarations expected',
      declared: 'declarations made',
      notDeclared: 'did not declare',
    };
    const cycle = part === 'all' ? '' : `, ${part} cycle`;
    return `${figures[figure] ?? figure}${cycle}`;
  }
  return path;
}
