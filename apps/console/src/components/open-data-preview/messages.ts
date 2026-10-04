/**
 * Copy of the Commission open-data preview (spec 09b FE-3, S6). One English string per key; the
 * Swahili slot stays empty until translations are reviewed by EACC.
 */
export const en = {
  title: 'Open data preview',
  from: 'From',
  published: (date: string) => `Published ${date}`,
  built: (date: string) => `Built ${date}`,
  notPublicYet: 'Not public yet',
  publicPage: 'Public page',
  publicPageHint: 'opens in a new tab',
  declarations: 'Declarations',
  declarationsCaption: 'Declarations by cycle',
  cycle: 'Cycle',
  cycles: { initial: 'Initial', biennial: 'Biennial', final: 'Final', all: 'All cycles' },
  expected: 'Expected',
  declared: 'Declared',
  didNotDeclare: 'Did not declare',
  rate: 'Rate',
  nothingExpected: 'n/a',
  nothingExpectedText: 'No officers expected',
  compliance: 'Compliance',
  complianceFigures: {
    determinationsCompliant: 'Determinations: compliant',
    determinationsNonCompliant: 'Determinations: non-compliant',
    determinationsFurtherAction: 'Determinations: further action',
    clarificationsIssued: 'Clarifications: issued',
    clarificationsResolved: 'Clarifications: resolved',
    actionsNoticeToComply: 'Administrative actions: notice',
    actionsWarning: 'Administrative actions: warning',
    actionsSalaryStoppage: 'Administrative actions: salary stoppage',
    actionsDisciplinaryReferral: 'Administrative actions: disciplinary',
    referrals: 'Referrals',
  },
  accessRequests: 'Access requests',
  accessRequestFigures: { received: 'Received', granted: 'Granted', declined: 'Declined' },
  noRow: 'No figures for your Commission in this release.',
  emptyTitle: 'No open-data release yet',
  emptyText: 'Your figures appear here when EACC builds a release.',
  errorTitle: 'We could not load your open-data figures',
  errorDetail: 'Try again in a moment.',
  tryAgain: 'Try again',
  forStaff: 'This page is for your Commission administrator.',
  forEacc: 'EACC sees every Commission in Open data.',
  backToOverview: 'Go to overview',
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
