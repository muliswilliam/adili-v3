import { formatNumber } from '../format';

/**
 * Copy of EACC's national consolidated report page (spec 09 FE-4, #233), as the 09-form-m
 * prototype words it. One English string per key; the Swahili slot stays empty until
 * translations are reviewed by EACC.
 */
export const en = {
  title: 'National report',
  workspaceTitle: 'Compliance reports',

  loadErrorTitle: 'The national report could not be loaded',
  loadErrorDetail: 'Check your connection and try again.',
  tryAgain: 'Try again',
  noAccess: 'Only EACC analysts and supervisors work on the national consolidated report.',
  backToOverview: 'Back to overview',

  noReportsTitle: (fy: string) => `No reports for ${fy} yet`,
  noReportsText: (due: string) => `Form M reports are due ${due}.`,
  notBuiltTitle: 'National report not built yet',
  notBuiltText: (reported: number, notReported: number) =>
    `${commissions(reported)} reported${notReported > 0 ? `, ${formatNumber(notReported)} have not` : ''}. You can rebuild later.`,
  build: (reported: number) => `Build from ${formatNumber(reported)} submitted reports`,
  building: (reported: number) => `Building from ${formatNumber(reported)} submitted reports…`,
  built: (reports: number) => `Built from ${formatNumber(reports)} reports. Narrative kept.`,
  buildFailed: 'The report could not be built. Try again.',
  noSubmittedReports: 'No Commission has submitted its report for the year yet.',

  draft: 'Draft',
  approved: 'Approved',
  builtFrom: (reports: number) => `Built from ${formatNumber(reports)} reports`,
  author: (name: string) => `Author ${name}`,
  approvedBy: (name: string, at: string) => `Approved by ${name}, ${at}`,
  rebuild: 'Rebuild',
  rebuilding: 'Rebuilding…',
  approve: 'Approve',
  authorCannotApprove: 'The author cannot approve',
  onlySupervisorApproves: 'Only an EACC supervisor can approve',
  downloadPdf: 'Download PDF',
  preparingPdf: 'Preparing PDF…',
  pdfSlow: 'The PDF is taking longer than usual.',
  checkAgain: 'Check again',
  pdfFailed: 'The PDF could not be downloaded. Try again.',

  newReports: (count: number) =>
    `${formatNumber(count)} new report${count === 1 ? '' : 's'} since this build.`,
  newReportsText: 'Rebuilding keeps the narrative.',

  totalsTitle: 'National totals',
  totalsCaption: 'National totals per Form M section',
  columnSection: 'Section',
  columnExpected: 'Expected',
  columnDeclared: 'Declared',
  columnNotDeclared: 'Did not declare',
  columnRate: 'Rate',
  sectionRow: {
    initial: '1. Initial declarations',
    biennial: '2. Biennial declarations',
    final: '3. Final declarations',
  },
  allSections: 'All sections',

  byCommissionTitle: 'By Commission',
  byCommissionCaption: 'Declared rates per Commission',
  columnCommission: 'Commission',
  columnStatus: 'Status',
  columnInitial: 'Initial',
  columnBiennial: 'Biennial',
  columnFinal: 'Final',
  notReportedCell: 'No report',
  noCycleCell: 'No biennial cycle',
  pagination: 'Commissions pages',
  pageRange: (from: number, to: number, total: number) =>
    `${formatNumber(from)}-${formatNumber(to)} of ${formatNumber(total)}`,
  pageRows: (count: number) => `${formatNumber(count)} Commissions`,
  previousPage: 'Previous page',
  nextPage: 'Next page',

  narrativeTitle: 'Narrative',
  writtenByAnalyst: 'Written by the analyst',
  frozenAtApproval: 'Frozen at approval',
  aiDraft: 'AI draft',

  approveTitle: 'Approve the national report?',
  approveText: (fy: string) =>
    `Approve the national consolidated report for ${fy}? It receives its NCR reference and the Restricted PDF is issued under your name. It can no longer be edited or rebuilt.`,
  approveAuthor: 'Author',
  approveApprover: 'Approver',
  approving: 'Approving…',
  approvingText: 'Allocating the NCR reference and issuing the PDF.',
  cancel: 'Cancel',
  separationOfDuties:
    'You built or wrote part of this report, so another EACC supervisor must approve it.',
  approveForbidden: 'Only an EACC supervisor who did not write the report can approve it.',
  approveFailed: 'The report could not be approved just now. Nothing was approved. Try again.',
  approvedToast: (reference: string | null) =>
    reference ? `Approved as ${reference}.` : 'Approved.',
  unknownOfficer: 'Not recorded',
} as const;

function commissions(count: number): string {
  return `${formatNumber(count)} Commission${count === 1 ? '' : 's'}`;
}

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
