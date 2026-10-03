import type { LadderFilter } from '../../actions/ladder';
import type { DecisionRefusal } from '../../actions/refusal';
import type { ActionStatus, ActionStep, Ladder } from '../../server/actions.server';

/**
 * Copy for the Actions screens and the approvals inbox's actions tab (spec 08 FE-5, FE-3). Step,
 * status and closing-cause labels come from the one table here (spec 08 i18n), each with an
 * English label and a Swahili slot, empty until translated; screens read English. `sw` holds
 * the page copy's Swahili, key by key, likewise empty.
 */

interface Label {
  en: string;
  /** Empty until translated. */
  sw: string;
}

const label = (text: string): Label => ({ en: text, sw: '' });

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

const STEP_LABELS: Record<ActionStep, Label> = {
  'notice-to-comply': label('Notice to comply'),
  warning: label('Warning'),
  'salary-stoppage': label('Salary stoppage'),
  'disciplinary-referral': label('Disciplinary referral'),
};

const STATUS_LABELS: Record<ActionStatus, Label> = {
  proposed: label('Awaiting approval'),
  approved: label('Approved, issuing'),
  'approved-pending-payroll': label('Approved, waiting for payroll'),
  declined: label('Declined'),
  issued: label('Issued'),
  responded: label('Responded'),
  complied: label('Complied'),
  reinstated: label('Salary reinstated'),
  cancelled: label('Not needed'),
};

const LADDER_STATUS_LABELS: Record<Ladder['status'], Label> = {
  active: label('Active'),
  complied: label('Complied'),
  declined: label('Declined'),
  ended: label('Ended'),
};

const CLOSING_CAUSES: Record<NonNullable<Ladder['closingCause']>, Label> = {
  filed: label('declaration filed'),
  'clarification-responded': label('clarification answered'),
  'clarification-resolved': label('clarification resolved'),
  'obligation-cancelled': label('filing obligation cancelled'),
  'clarification-withdrawn': label('clarification withdrawn'),
};

/** A step's name: "Notice to comply". */
export const stepLabel = (step: ActionStep): string => STEP_LABELS[step].en;
/** An action's status in words. */
export const statusLabel = (status: ActionStatus): string => STATUS_LABELS[status].en;
/** A ladder's status in words. */
export const ladderStatusLabel = (status: Ladder['status']): string =>
  LADDER_STATUS_LABELS[status].en;
/** What closed a ladder, mid-sentence: "declaration filed". */
export const closingCauseLabel = (cause: NonNullable<Ladder['closingCause']>): string =>
  CLOSING_CAUSES[cause].en;

export const en = {
  title: 'Actions',
  forbidden: 'You do not have access to administrative actions.',
  // List
  filtersLabel: 'Show ladders',
  filters: {
    all: 'All',
    awaiting: 'Awaiting approval',
    running: 'Window running',
    responded: 'Responded',
    complied: 'Complied',
    declined: 'Declined',
  } satisfies Record<LadderFilter, string>,
  columns: {
    subject: 'Subject',
    declarant: 'Declarant',
    step: 'Current step',
    window: 'Window ends',
  },
  fileNumber: (n: string) => `File ${n}`,
  review: 'Review',
  open: 'Open',
  openLabel: (name: string) => `Open the ladder of ${name}`,
  inDays: (days: number) =>
    days === 0
      ? 'today'
      : days > 0
        ? `in ${plural(days, 'day', 'days')}`
        : `${plural(-days, 'day', 'days')} ago`,
  compliedOn: (date: string) => `Complied ${date}`,
  ended: 'Ended',
  emptyTitle: 'No administrative actions yet',
  emptyBody: 'A ladder starts when a declaration or clarification is overdue.',
  emptyFilteredTitle: 'No ladders match',
  emptyFilteredBody: 'Try another filter.',
  showAll: 'Show all',
  windows: 'Windows: notice 14 days · warning 14 days · stoppage 30 days',
  loadErrorTitle: 'We could not load the ladders',
  loadErrorDetail: 'The review service did not answer. Try again in a moment.',
  tryAgain: 'Try again',
  pagination: 'Ladder pages',
  pageRange: (from: number, to: number) => `Showing ${String(from)}-${String(to)} ladders`,
  pageRows: (count: number) => `Showing ${plural(count, 'ladder', 'ladders')}`,
  previousPage: 'Previous page',
  nextPage: 'Next page',
  // Detail
  ladderLabel: 'Administrative action ladder',
  notFoundTitle: 'Ladder not found',
  notFoundBody: 'The link may be wrong, or the ladder belongs to another Commission.',
  backToActions: 'Back to Actions',
  detailErrorTitle: 'We could not load this ladder',
  fileNumberLine: (n: string) => `Personnel file ${n}`,
  stepDetail: {
    drafted: (date: string) => `drafted ${date}`,
    issued: (date: string) => `Issued ${date}`,
    declined: (date: string) => `Declined ${date}`,
    complied: (date: string) => `Complied ${date}`,
    reinstated: (date: string) => `Reinstated ${date}`,
    respondedOn: (date: string) => `Responded ${date}`,
  },
  stoppageWindow: (date: string) => `Stoppage window ends ${date}`,
  numberOnApproval: 'Number on approval',
  facts: {
    drafted: 'Drafted',
    approved: 'Approved',
    issued: 'Issued',
    actBy: 'Act by',
    declined: 'Declined',
    approver: 'Approver',
    by: (name: string) => `by ${name}`,
    bySystem: 'by the system',
  },
  approverReviewStaff: 'A reviewer or supervisor',
  approverSupervisor: 'A supervisor',
  letterTitle: (step: ActionStep) => `${stepLabel(step)} letter`,
  restricted: 'Restricted',
  viewLetter: 'View',
  downloadLetter: 'PDF',
  letterUnavailable: 'The letter could not be opened. Try again in a moment.',
  issuingLetter: 'The letter is being issued.',
  response: 'Declarant response',
  responseNote: 'Responses do not pause the ladder.',
  noResponse: 'No response from the declarant.',
  attachmentHint: 'Scanned clean',
  declinedBy: (name: string) => `Declined by ${name}`,
  nextStepDetail: (date: string) => `Drafted ${date} if still not complied.`,
  approve: 'Approve',
  decline: 'Decline',
  /** Why the service refused a decision, one line per refusal (the Actions view and the inbox). */
  refusals: {
    proposer: 'You cannot approve this: you proposed it.',
    'reviewer-of-record': 'You cannot approve this: you reviewed this case.',
    role: 'Only a supervisor can approve this step.',
    'not-proposed': 'Someone decided this step while the page was open.',
    'not-declined': 'This ladder is no longer declined.',
  } satisfies Record<DecisionRefusal, string>,
  /** A reviewer's restart, refused 403 `supervisor-required`. */
  restartRefused: 'Only a supervisor can restart a ladder.',
  subject: {
    obligation: 'Filing obligation',
    clarification: 'Clarification',
    started: 'Ladder started',
    ended: 'Ladder ended',
  },
  // Ladder banners
  declinedTitle: (step: ActionStep, name: string, date: string) =>
    `Ladder ended: ${stepLabel(step).toLowerCase()} declined by ${name} on ${date}`,
  declinedBody: 'Nothing more is drafted unless a supervisor restarts it.',
  restart: 'Restart ladder',
  compliedTitle: (date: string, cause: string) => `Complied on ${date}: ${cause}.`,
  compliedBody: 'Open steps were closed as complied. Nothing more is drafted.',
  endedTitle: (date: string, cause: string) => `Ladder ended on ${date}: ${cause}.`,
  endedBody: 'The ladder closed without compliance being needed.',
  // Approve dialog
  approveTitle: (step: ActionStep) => `Approve ${stepLabel(step).toLowerCase()}`,
  consequences: {
    reference: 'An ADM number is allocated in your name',
    letter: (step: ActionStep) => `The ${stepLabel(step).toLowerCase()} letter is issued`,
    letterDetail: 'Restricted, with what is overdue, what to do and a response option',
    actBy: (date: string) => `The declarant must act by ${date}`,
    actByDetail: (days: number) => `${plural(days, 'day', 'days')} from today`,
    notified: (name: string) => `${name} is notified`,
    notifiedDetail: 'By email, SMS and in the portal',
    salaryStopped: "The declarant's salary is stopped",
    salaryStoppedDetail:
      "A stop-salary instruction goes to payroll for the declarant's reporting entity; it is reinstated automatically when they comply",
    disciplinary: 'The reporting entity is told to start disciplinary proceedings',
    disciplinaryDetail:
      'Recorded as an event for the employer; the ladder then waits for compliance',
  },
  approveAndIssue: 'Approve and issue',
  approved: (step: ActionStep, reference: string | null) =>
    reference ? `${stepLabel(step)} approved: ${reference}` : `${stepLabel(step)} approved`,
  approvedDetail: 'The letter is issued and the declarant notified.',
  // Decline dialog
  declineTitle: (step: ActionStep) => `Decline ${stepLabel(step).toLowerCase()}`,
  /** A declined disciplinary referral leaves the ladder open (spec 08 S10); any other step ends it. */
  declineWarning: (step: ActionStep) =>
    step === 'disciplinary-referral'
      ? 'Declining keeps the ladder open: it waits for compliance, and a stopped salary stays stopped until then.'
      : 'Declining ends this ladder. A supervisor can restart it.',
  note: 'Note',
  notePlaceholder: 'Say why.',
  noteCounter: (n: number) => `${n.toLocaleString('en-KE')} / 2,000`,
  noteMissing: 'Say why you are declining.',
  noteTooLong: 'Keep the note to 2,000 characters.',
  declined: (step: ActionStep) => `${stepLabel(step)} declined`,
  declinedDetail: (step: ActionStep) =>
    step === 'disciplinary-referral' ? 'The ladder waits for compliance.' : 'The ladder has ended.',
  // Restart dialog
  restartTitle: 'Restart this ladder?',
  restartBody: (step: ActionStep) =>
    `The ${stepLabel(step).toLowerCase()} is drafted again and waits for approval. Steps already issued stand.`,
  restarted: 'Ladder restarted',
  restartedDetail: (step: ActionStep) => `The ${stepLabel(step).toLowerCase()} is drafted again.`,
  cancel: 'Cancel',
  // Failures
  failed: {
    unavailable: 'The review service did not answer. Nothing changed; try again.',
    signedOut: 'Your session has ended. Sign in again to continue.',
    notProposed: 'This step was decided by someone else. The ladder has been reloaded.',
    notDeclined: 'This ladder is no longer declined. It has been reloaded.',
    other: 'This could not be done. Reload the page and try again.',
  },
} as const;

/** Swahili for `en`, key by key; empty until translated. */
export const sw: Partial<Record<keyof typeof en, string>> = {};
