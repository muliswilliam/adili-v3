import { plural } from '@adili/ui';

import type { Outcome } from './decision-rules';

/**
 * Copy of the decision form, the decision summary and the package status (spec 10, #260), from
 * the console prototype (`apps/console/prototype/10-access.prototype.html`, `#decide`). Shared by
 * Form K and law enforcement requests (#265). English only, as `access/messages.ts`.
 */
export const en = {
  // Decide page
  decideTitle: 'Decide',
  decideCrumb: 'Decide',
  decisionTitle: 'Decision',
  decisionDue: 'Decision due',
  decide: 'Decide',
  outcome: 'Outcome',
  outcomes: {
    grant: 'Grant',
    'partial-grant': 'Partial grant',
    deny: 'Deny',
  } satisfies Record<Outcome, string>,
  nothingToNarrow: 'Nothing to leave out: one year and one section were requested.',
  grantReleases: (scope: string) => `Releases the full requested scope: ${scope}.`,
  grantedScope: 'Granted scope',
  grantedScopeHint: 'Only what was requested can be granted.',
  sameAsRequested: 'This is the full requested scope. Choose Grant instead.',
  reasons: 'Reasons',
  reasonsPlaceholder: 'Why you decided this, in plain words',
  reasonsCount: (count: number) => `${count.toLocaleString('en-KE')} / 4,000`,
  cancel: 'Cancel',
  recordDecision: 'Record decision',

  // Form K wording (law enforcement requests pass their own)
  reasonsToBoth: 'Sent to the applicant and the declarant.',
  finalToBoth: 'This decision is final and will be communicated to both parties.',

  // Request context beside the form
  contextLabel: 'The request decided',
  requestTitle: 'Request',
  applicant: 'Applicant',
  reason: 'Reason',
  officer: 'Officer',
  scopeRequested: 'Scope requested',

  // Client checks, as the access service's decisionOf
  chooseOutcome: 'Choose an outcome.',
  chooseYear: 'Choose at least one year.',
  chooseSection: 'Choose at least one section.',
  chooseGround: 'Choose at least one ground for a partial grant or a denial.',
  enterReasons: 'Enter the reasons.',
  reasonsTooLong: 'Keep the reasons to 4,000 characters.',

  // Confirm
  confirmTitle: {
    grant: 'Record grant?',
    'partial-grant': 'Record partial grant?',
    deny: 'Record denial?',
  } satisfies Record<Outcome, string>,
  confirmGrounds: 'Grounds:',
  packageGoesTo: (name: string) => `A Confidential package goes to ${name}`,
  packageScope: (scope: string, days: number) =>
    `${scope}. Watermarked, downloadable for ${plural(days, 'day')}.`,

  // Server answers
  notRecordedTitle: 'The decision was not recorded',
  alreadyDecidedTitle: 'Already decided',
  alreadyDecided:
    'This request was decided while you were working on it. Decisions are final. Open the request to see the decision.',
  closedTitle: 'The request is closed',
  closed: 'The request was closed before your decision was recorded. Open the request to see why.',
  notUnderDecisionTitle: 'Not ready to decide',
  notUnderDecision:
    "The request is not under decision: the declarant's window for representations is still open.",
  openRequest: 'Open the request',
  forbidden: 'Only the access officer decides. Nothing was recorded.',
  sessionEnded: 'Your session has ended. Sign in again.',
  unavailable: 'The access service did not answer. Nothing was recorded. Try again.',
  groundsRequired: 'A partial grant or a denial needs at least one Regulation 24 ground.',
  scopeExceeds: 'The granted scope asks for more than the request did. Narrow it.',
  scopeNotNarrower: 'The granted scope is the whole requested scope. Choose Grant instead.',
  scopeRejected: 'The access service did not accept the granted scope.',
  groundsRejected: 'The access service did not accept the grounds.',
  reasonsRejected: 'The access service did not accept the reasons.',
  badRequest: 'The access service did not accept the decision. Check it and try again.',
  recorded: 'Decision recorded. Both parties are being notified.',

  // Decide page when there is nothing to decide
  readOnlyTitle: 'Only the access officer decides',
  readOnlyText: 'Supervisors can read requests and decisions.',
  decidedTitle: 'Already decided',
  decidedText: (name: string, date: string) =>
    `Decided by ${name} on ${date}. Decisions are final.`,
  notReadyText: 'The request must be under decision first.',
  backToRequest: 'Back to request',

  // Decision summary
  final: 'Final',
  decided: {
    grant: 'Granted',
    'partial-grant': 'Partially granted',
    deny: 'Denied',
  } satisfies Record<Outcome, string>,
  grounds: 'Regulation 24 grounds',
  decidedBy: 'Decided by',

  // Package
  packageTitle: 'Package',
  confidential: 'Confidential',
  preparing: 'Preparing: rendering the granted scope, watermarking and signing.',
  issued: 'Issued',
  downloadUntil: 'Download until',
  windowClosed: 'Window closed',
  closedBadge: 'Closed',
  endsToday: 'Ends today',
  downloads: 'Downloads',
  lastDownload: (at: string) => `last ${at}`,
  watermark: 'Watermark',
  watermarkHint: 'On every page. A leaked copy traces back to its recipient.',
  verificationCode: 'Verification code',
  onlyRecipient: (name: string) => `Only ${name} can download it.`,
};

export const messages = en;
