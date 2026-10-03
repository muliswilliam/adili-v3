import type { ActionStatus, ActionStep, DeclarantNotice } from '../server/review/types';
import type { LadderStepState } from './view';

/**
 * Copy for the declarant's Notices (spec 08 FE-7). English; step and status labels come from
 * the one table here (spec 08 i18n).
 */

const days = (n: number) => `${String(n)} ${n === 1 ? 'day' : 'days'}`;

export const STEP_TITLES: Record<ActionStep, string> = {
  'notice-to-comply': 'Notice to comply',
  warning: 'Warning',
  'salary-stoppage': 'Salary stoppage',
  'disciplinary-referral': 'Disciplinary referral',
};

export const STEP_SHORT: Record<ActionStep, string> = {
  'notice-to-comply': 'Notice',
  warning: 'Warning',
  'salary-stoppage': 'Stoppage',
  'disciplinary-referral': 'Disciplinary',
};

export const STATUS_LABELS: Record<ActionStatus, string> = {
  proposed: 'Issued',
  approved: 'Issued',
  'approved-pending-payroll': 'Issued',
  issued: 'Issued',
  responded: 'Responded',
  complied: 'Complied',
  reinstated: 'Salary reinstated',
  declined: 'Closed',
  cancelled: 'Closed',
};

export const STRIP_STATES: Record<LadderStepState, string> = {
  current: 'Current',
  issued: 'Issued',
  complied: 'Complied',
  'not-issued': 'Not issued',
};

type WhatToDo = DeclarantNotice['whatToDo'];

export const COPY = {
  title: 'Notices',
  back: 'Notices',
  viewAll: 'View all',
  viewAllLabel: 'View all notices',
  emptyTitle: 'No notices',
  emptyBody: 'Notices are sent only when a declaration or a clarification response is overdue.',
  errorTitle: 'We could not load your notices',
  errorBody: 'Check your connection and try again.',
  tryAgain: 'Try again',
  notFoundTitle: 'Notice not found',
  notFoundBody: 'The link may be wrong, or the notice is not yours.',
  allNotices: 'All notices',
  ladderLabel: 'Administrative action steps',
  earlier: 'Earlier notices',
  issuedOn: (date: string) => `Issued ${date}`,
  actBy: (date: string) => `Act by ${date}`,
  daysLeft: (n: number) => (n === 0 ? 'today' : `${days(n)} left`),
  windowEnded: (date: string) => `Window ended ${date}`,
  followedBy: (step: ActionStep) =>
    step === 'warning'
      ? 'Followed by a warning'
      : `Followed by a ${STEP_TITLES[step].toLowerCase()}`,
  todo: {
    'file-declaration': 'File your declaration.',
    'respond-to-clarification': 'Respond to your clarification.',
  } satisfies Record<WhatToDo, string>,
  cta: {
    'file-declaration': 'File declaration',
    'respond-to-clarification': 'Respond now',
  } satisfies Record<WhatToDo, string>,
  happened: {
    'file-declaration': 'You did not file a declaration that was due.',
    'respond-to-clarification': 'You did not respond to a clarification within 30 days.',
  } satisfies Record<WhatToDo, string>,
  actByBanner: (date: string, left: number) => `Act by ${date} (${COPY.daysLeft(left)}).`,
  consequence: (step: ActionStep, commission: string) =>
    step === 'notice-to-comply'
      ? `If you do not, ${commission} may issue a warning.`
      : step === 'warning'
        ? `If you do not, ${commission} may stop your salary.`
        : '',
  whatHappened: 'What happened',
  respond: 'Respond',
  optional: '(optional)',
  respondInfo: (commission: string, whatToDo: WhatToDo) =>
    whatToDo === 'file-declaration'
      ? [
          `Tell ${commission} why you could not act in time. `,
          'This does not stop the notice',
          '; only filing your declaration does. You can respond once.',
        ]
      : [
          `Tell ${commission} why you could not act in time. `,
          'This does not stop the notice',
          '; only responding to the clarification does. You can respond once.',
        ],
  yourResponse: 'Your response',
  counter: (n: number) => `${n.toLocaleString('en-KE')} / 4,000`,
  placeholder: 'For example, why you could not act in time',
  missing: 'Write your response before submitting.',
  tooLong: 'Keep your response to 4,000 characters.',
  documents: 'Documents',
  attach: 'Attach a document',
  attachHint: 'Optional. PDF, JPEG, PNG or HEIC, up to 20 MB.',
  attachLimit: 'You have attached the most documents allowed (10).',
  removeBody: 'The document will not be sent with your response.',
  submit: 'Submit response',
  checkingFiles: 'Checking documents',
  filesStillChecking: 'Your documents are still being checked. Submit when they are ready.',
  filesNotAccepted: 'Remove the documents that could not be attached, then submit.',
  confirmTitle: 'Submit your response?',
  confirmBody: 'You can respond once.',
  confirmWarning: (step: ActionStep, whatToDo: WhatToDo) =>
    `This does not stop the ${STEP_TITLES[step].toLowerCase()}. To comply, ${
      whatToDo === 'file-declaration' ? 'file your declaration' : 'respond to your clarification'
    }.`,
  cancel: 'Cancel',
  sending: 'Sending',
  sent: 'Response sent',
  networkError: 'Your response was not sent. Check your connection and try again.',
  signedOut: 'Your session has ended.',
  signIn: 'Sign in again',
  attachmentNotClean: 'A document could not be accepted. Remove it and try again.',
  closedNow: 'This notice has closed. It has been reloaded.',
  alreadyResponded: 'A response to this notice was already sent, maybe from another device.',
  respondedBanner: 'Your response is on record.',
  respondedBody: (whatToDo: WhatToDo) =>
    ` It does not stop this notice. To comply: ${
      whatToDo === 'file-declaration' ? 'file your declaration' : 'respond to your clarification'
    }.`,
  respondedAt: (date: string) => date,
  compliedBanner: 'You have complied. No further action will be taken.',
  salaryStopped:
    'Your salary has been stopped pending compliance. It will be reinstated automatically when you comply.',
  salaryReinstated: (date: string) => `Your salary reinstatement was sent to payroll on ${date}.`,
  salaryStoppedBadge: 'Salary stopped',
  closedBanner: 'This notice is closed. You do not need to act on it.',
  windowLeft: (n: number) => (n < 0 ? 'Window ended' : n === 0 ? 'Last day' : `${days(n)} left`),
  windowLine: (date: string, day: number, of: number) =>
    `Act by ${date} · day ${String(day)} of ${String(of)}`,
  letter: 'Letter',
  letterRestricted: 'Restricted letter, for you and your Commission.',
  downloadLetter: 'Download PDF',
  letterNotReady: 'The letter is being prepared. Check back shortly.',
  history: 'History',
  historyIssued: (step: ActionStep) => `${STEP_TITLES[step]} issued`,
  historyResponded: 'You responded',
  historyComplied: 'You complied',
} as const;
