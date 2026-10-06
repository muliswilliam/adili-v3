import { formatDate } from '@adili/ui';

import { en, type Label } from '../declaration/translatable';
import type { ActionStatus, ActionStep, DeclarantNotice } from '../server/review/types';
import type { LadderStepState } from './view';

/**
 * Copy for the declarant's Notices (spec 08 FE-7). Step, status and step-strip labels come from
 * the tables here (spec 08 i18n: one shared table), each with an English label and a Swahili
 * slot, empty until the Swahili copy is done; screens read English. `COPY_SW` holds the page
 * copy's Swahili, key by key, likewise empty.
 */

const days = (n: number) => `${String(n)} ${n === 1 ? 'day' : 'days'}`;

export const STEP_TITLES: Record<ActionStep, Label> = {
  'notice-to-comply': en('Notice to comply'),
  warning: en('Warning'),
  'salary-stoppage': en('Salary stoppage'),
  'disciplinary-referral': en('Disciplinary referral'),
};

export const STEP_SHORT: Record<ActionStep, Label> = {
  'notice-to-comply': en('Notice'),
  warning: en('Warning'),
  'salary-stoppage': en('Stoppage'),
  'disciplinary-referral': en('Disciplinary'),
};

export const STATUS_LABELS: Record<ActionStatus, Label> = {
  proposed: en('Issued'),
  approved: en('Issued'),
  'approved-pending-payroll': en('Issued'),
  issued: en('Issued'),
  responded: en('Responded'),
  complied: en('Complied'),
  reinstated: en('Salary reinstated'),
  declined: en('Closed'),
  cancelled: en('Closed'),
};

/** A notice whose salary stoppage is in force reads so, whatever its step's status. */
export const SALARY_STOPPED: Label = en('Salary stopped');

export const STRIP_STATES: Record<LadderStepState, Label> = {
  current: en('Current'),
  issued: en('Issued'),
  complied: en('Complied'),
  'not-issued': en('Not issued'),
};

type Subject = DeclarantNotice['subject'];

const DECLARATIONS: Record<string, string> = {
  initial: 'initial declaration',
  biennial: 'biennial declaration',
  final: 'final declaration',
};

/**
 * What failed, as the letter names it: the declaration by its cycle ("biennial declaration
 * 2027"), or the clarification by its CLR number.
 */
export function subjectName(subject: Subject): string {
  if (subject.kind === 'clarification') return `clarification ${subject.reference}`;
  const [kind = '', when = ''] = subject.reference.split(':');
  const name = DECLARATIONS[kind] ?? 'declaration';
  return kind === 'biennial' && /^\d{4}$/.test(when) ? `${name} ${when}` : name;
}

/** How to comply, in the imperative ("file your biennial declaration 2027"). */
export function complyBy(subject: Subject): string {
  return subject.kind === 'clarification'
    ? `respond to ${subjectName(subject)}`
    : `file your ${subjectName(subject)}`;
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

type WhatToDo = DeclarantNotice['whatToDo'];

export const COPY = {
  title: 'Notices',
  back: 'Notices',
  home: 'Home',
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
      : `Followed by a ${STEP_TITLES[step].en.toLowerCase()}`,
  todo: (subject: Subject) => sentence(complyBy(subject)),
  cta: {
    'file-declaration': 'File declaration',
    'respond-to-clarification': 'Respond now',
  } satisfies Record<WhatToDo, string>,
  /** What the declarant failed to do, by the response's due date when the subject has one. */
  happened: (subject: Subject) =>
    subject.kind === 'clarification'
      ? subject.dueAt
        ? `You did not respond to ${subjectName(subject)} by ${formatDate(subject.dueAt)}, when your response was due.`
        : `You did not respond to ${subjectName(subject)} in time.`
      : `You did not file your ${subjectName(subject)} by its due date.`,
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
  respondInfo: (commission: string, subject: Subject) => [
    `Tell ${commission} why you could not act in time. `,
    'This does not stop the notice',
    subject.kind === 'clarification'
      ? `; only responding to ${subjectName(subject)} does. You can respond once.`
      : `; only filing your ${subjectName(subject)} does. You can respond once.`,
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
  confirmWarning: (step: ActionStep, subject: Subject) =>
    `This does not stop the ${STEP_TITLES[step].en.toLowerCase()}. To comply, ${complyBy(subject)}.`,
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
  respondedBody: (subject: Subject) =>
    ` It does not stop this notice. To comply, ${complyBy(subject)}.`,
  compliedBanner: 'You have complied. No further action will be taken.',
  salaryStopped:
    'Your salary has been stopped pending compliance. It will be reinstated automatically when you comply.',
  closedBanner: 'This notice is closed. You do not need to act on it.',
  windowLeft: (n: number) => (n < 0 ? 'Window ended' : n === 0 ? 'Last day' : `${days(n)} left`),
  windowLine: (date: string, day: number, of: number) =>
    `Act by ${date} · day\u00a0${String(day)}\u00a0of\u00a0${String(of)}`,
  letter: 'Letter',
  letterRestricted: 'Restricted letter, for you and your Commission.',
  downloadLetter: 'Download PDF',
  letterNotReady: 'The letter is being prepared. Check back shortly.',
  history: 'History',
  historyIssued: (step: ActionStep) => `${STEP_TITLES[step].en} issued`,
  historyResponded: 'You responded',
  historyComplied: 'You complied',
} as const;

/** Swahili for `COPY`, key by key; empty until translated. */
export const COPY_SW: Partial<Record<keyof typeof COPY, string>> = {};
