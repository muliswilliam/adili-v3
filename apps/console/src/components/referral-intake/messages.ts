import { formatDate, formatDateTime, plural } from '@adili/ui';

import type { IcmsPushError, IcmsStatus, ReferralGrounds } from '../../server/reporting/types';

const STATUS = {
  'not-pushed': 'Not pushed',
  pushed: 'Pushed',
  registered: 'Registered',
  'push-failed': 'Failed',
} as const satisfies Record<IcmsStatus, string>;

/** Copy of EACC's Referrals received view, its detail drawer and push dialog (spec 09 FE-5). */
export const messages = {
  title: 'Referrals received',
  noAccess: 'Referrals received are for EACC analysts and supervisors.',
  confidential: 'Confidential',
  packageTip:
    'Confidential. Only EACC analysts and supervisors can download. Every download is recorded against your name.',
  grounds: {
    'undeclared-assets': 'Undeclared assets',
    'unexplained-assets': 'Unexplained assets',
    'two-missed-cycles': 'Two missed biennial cycles',
    'unanswered-clarification': 'Unanswered clarification',
  } satisfies Record<ReferralGrounds, string>,
  /** The Regulations each ground rests on. */
  legalBasis: {
    'undeclared-assets': 'Regs r.20(1)(c)',
    'unexplained-assets': 'Regs r.20(1)(c)',
    'two-missed-cycles': 'Regs r.20(2)',
    'unanswered-clarification': 'Regs r.20(2)',
  } satisfies Record<ReferralGrounds, string>,
  status: STATUS,
  waitingForCase: 'Waiting for case number',
  /** Why the last push failed, as the row and the drawer say it. */
  pushErrors: {
    'review-unavailable':
      "The Commission's referral details could not be read. Nothing was sent to ICMS.",
    'payload-not-found': "The referral's details were not found. Nothing was sent to ICMS.",
    'payload-refused': "The referral's details were refused. Nothing was sent to ICMS.",
    'icms-unavailable': 'ICMS did not respond. Nothing was registered.',
    'icms-rejected': 'ICMS rejected the referral. Nothing was registered.',
    'icms-failed': 'ICMS could not register the referral.',
    'icms-registration-timeout': 'ICMS accepted the referral but sent no case number in time.',
  } satisfies Record<IcmsPushError, string>,
  list: {
    filtersLabel: 'ICMS status',
    filters: { all: 'All', ...STATUS },
    caption: 'Referrals received from Commissions',
    reference: 'Reference',
    commission: 'Commission',
    groundsColumn: 'Grounds',
    sent: 'Sent',
    packageColumn: 'Package',
    icmsStatus: 'ICMS status',
    actions: 'Actions',
    package: 'Package',
    packageFor: (reference: string) => `Download the evidence package of ${reference}`,
    push: 'Push to ICMS',
    retry: 'Retry',
    view: 'View',
    viewFor: (reference: string) => `View ${reference}`,
    emptyTitle: 'No referrals received yet',
    emptyBody: 'Approved Commission referrals appear here.',
    noMatchesTitle: 'No referrals with this status',
    noMatchesBody: 'Choose another filter to see more.',
    showAll: 'Show all',
    loadFailed: {
      title: 'Could not load referrals',
      body: 'Nothing has changed. Try again in a moment.',
      retry: 'Try again',
    },
    pager: {
      pagination: 'Referrals pages',
      pageRange: (from: number, to: number) => `Showing ${String(from)}-${String(to)}`,
      pageRows: (count: number) => `Showing ${plural(count, 'referral')}`,
      previousPage: 'Previous page',
      nextPage: 'Next page',
    },
  },
  detail: {
    subtitle: (commission: string, sentAt: string) => `${commission} · sent ${formatDate(sentAt)}`,
    grounds: 'Grounds',
    legalBasis: 'Legal basis',
    cycle: 'Declaration cycle',
    caseNumber: 'ICMS case number',
    packageTitle: 'Evidence package',
    download: 'Download',
    failedTitle: 'ICMS did not register this referral.',
    waiting: 'Waiting for ICMS to assign a case number.',
    commissionSees: (caseNumber: string) =>
      `The Commission sees "ICMS case ${caseNumber}" on its referral.`,
    history: 'History',
    received: 'Received from the Commission',
    pushedBy: (name: string) => `Pushed to ICMS by ${name}`,
    pushFailed: 'Push failed',
    at: (at: string) => formatDateTime(at),
    close: 'Close',
  },
  pushDialog: {
    title: 'Push to ICMS',
    retryTitle: 'Retry push to ICMS',
    body: 'Send this referral to ICMS? The case number will be recorded.',
    receives: 'What ICMS receives',
    referral: 'Referral',
    commission: 'Referring Commission',
    grounds: 'Grounds',
    declarant: 'Declarant',
    declarantValue: 'ID number and full name',
    sending: 'Sending to ICMS…',
    sendingDetail: 'Waiting for the case number.',
    cancel: 'Cancel',
    confirm: 'Push to ICMS',
    retry: 'Retry',
  },
  toasts: {
    registered: (caseNumber: string) => `Registered in ICMS as ${caseNumber}`,
    pushed: 'ICMS accepted the referral. Its case number follows.',
    failed: 'ICMS did not register the referral. Try again.',
    downloadFailed: 'The package could not be downloaded. Try again in a moment.',
    sessionEnded: 'Your session has ended. Sign in again.',
  },
  /** A push that got no answer, in the dialog. */
  pushUnanswered: {
    title: 'The push did not complete.',
    detail: 'Try again. ICMS never registers a referral twice.',
  },
  /** A push refused for good, in the dialog: trying again will not help. */
  pushRefused: {
    403: 'Only EACC analysts and supervisors can push referrals to ICMS.',
    404: 'This referral is no longer in the intake.',
    other: 'Reporting refused the push. Reload the page and try again.',
  },
} as const;
