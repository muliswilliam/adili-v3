import { type BadgeProps, plural } from '@adili/ui';

import type { ClarificationStatus, Requirement } from '../server/review/types';

/**
 * Words for the declarant's clarification page (spec 07a FE-5). Requirements and statuses are
 * keyed by the contract's types, so a value the contract adds is a type error here until it has
 * words. Each has an English label and a Swahili slot, empty until the Swahili copy is done
 * (out of scope for spec 07a); screens read English.
 */

interface Label {
  en: string;
  /** Empty until translated. */
  sw: string;
}

const en = (text: string): Label => ({ en: text, sw: '' });

/** What each s.35(4) requirement asks of the declarant, in plain words. */
export const REQUIREMENTS = {
  'provide-omitted': {
    ask: en('Your Commission asks you to provide the omitted information for:'),
    placeholder: en('Give the missing details. Attach a statement if you have one.'),
  },
  'explain-discrepancy': {
    ask: en('Your Commission asks you to explain the discrepancy in:'),
    placeholder: en('Explain in your own words. Short, clear answers are best.'),
  },
  correct: {
    ask: en('Your Commission asks you to correct:'),
    placeholder: en('Say what the correct entry is and why.'),
  },
} satisfies Record<Requirement, { ask: Label; placeholder: Label }>;

/** Drafts never reach the declarant; the label is there so every status has one. */
export const STATUSES = {
  draft: { label: en('Draft'), variant: 'default' },
  issued: { label: en('Open'), variant: 'brand' },
  overdue: { label: en('Overdue'), variant: 'destructive' },
  responded: { label: en('Responded'), variant: 'info' },
  resolved: { label: en('Resolved'), variant: 'success' },
  withdrawn: { label: en('Withdrawn'), variant: 'default' },
} satisfies Record<ClarificationStatus, { label: Label; variant: BadgeProps['variant'] }>;

export const COPY = {
  back: 'Your dashboard',
  title: (followUp: boolean) => (followUp ? 'Further clarification' : 'Clarification'),
  declaration: (reference: string) => `Declaration ${reference}`,
  askedOpen: 'What your Commission asks',
  askedAnswered: 'What was asked and your response',
  askedClosed: 'What was asked',
  answerOnce: 'Answer every point. You can respond once.',
  point: (n: number, of: number) => `Point ${String(n)} of ${String(of)}`,
  yourResponse: 'Your response',
  responseLabel: (n: number) => `Your response to point ${String(n)}`,
  counter: (used: number) => `${used.toLocaleString('en')} / 2,000`,
  missing: 'Write your response to this point.',
  tooLong: 'Keep your response to 2,000 characters or fewer.',
  documentsFor: (n: number) => `Documents for point ${String(n)}`,
  attach: 'Attach a document',
  attachHint: 'Optional. PDF, JPEG, PNG or HEIC, up to 20 MB.',
  attachLimit: 'You have attached the most documents a point can take (10).',
  removeBody: 'The document will not be sent with your response.',
  noDocuments: 'No documents attached.',
  answered: (count: number, of: number) =>
    `${String(count)} of ${String(of)} ${of === 1 ? 'point' : 'points'} answered`,
  submit: 'Submit response',
  checkingFiles: 'Checking files…',
  networkError:
    'We could not send your response. Check your connection and try again. Your answers are still here.',
  signedOut: 'Your session has ended. Sign in again, then submit your response.',
  signIn: 'Sign in',
  unanswered: (n: number) =>
    `Answer every point before you submit. Point ${String(n)} needs an answer.`,
  filesNotAccepted: 'Remove the documents that were not accepted before you submit.',
  filesStillChecking: 'Wait until your documents have been checked.',
  attachmentNotClean:
    'One of your documents did not pass the security check. Remove it and attach a different copy.',
  closedNow: 'This clarification is closed and no longer needs a response.',
  sent: 'Response sent to your Commission.',

  confirmTitle: 'Submit your response?',
  confirmBody: 'You can respond once. Make sure every point is answered.',
  confirmClarification: 'Clarification',
  confirmPoints: 'Points answered',
  confirmDocuments: 'Documents attached',
  confirmLate: (due: string, days: number) =>
    `The due date was ${due}. Your response will be recorded as ${plural(days, 'day')} late.`,
  checkAgain: 'Check again',
  sending: 'Sending…',

  overdueTitle: 'The deadline has passed.',
  overdueBody: 'You can still respond; your response will be recorded as late.',
  reminder: (countdown: string, due: string) => `Reminder: ${countdown.toLowerCase()}. Due ${due}.`,
  submittedTitle: (at: string) => `Response submitted ${at}.`,
  respondedLate: (days: number) => `Responded ${plural(days, 'day')} late.`,
  willReview: (commission: string) => `${commission} will review it.`,
  furtherSent: (commission: string) => `${commission} sent a further clarification.`,
  furtherOwnPeriod: 'It has its own 30 days.',
  openFurther: (reference: string) => `Open ${reference}`,
  followsUp: (reference: string) => `Follows up on your response to ${reference}.`,
  followsUpUnknown: 'Follows up on your earlier response.',
  seeBefore: 'See what you said before',
  resolved: (at: string) => `Resolved on ${at}.`,
  resolvedBody: (commission: string) => `${commission} accepted your response.`,
  withdrawn: 'Withdrawn: issued in error.',
  withdrawnBody: 'You do not need to respond.',
  conflictTitle: 'A response was already submitted,',
  conflictBody: 'possibly from another device. You can respond only once.',
  showIt: 'Show it',

  periodLabel: 'Response period',
  noResponseNeeded: 'No response needed',
  withdrawnPeriod: 'The clarification was withdrawn.',
  respondedOnTime: 'Responded on time',
  submittedDue: (at: string, due: string) => `Response submitted ${at} · due ${due}`,
  wasDue: (due: string) => `Was due ${due}. You can still respond.`,
  dueDay: (due: string, day: number, of: number) =>
    `Due ${due} · day ${String(day)} of ${String(of)}`,

  letter: 'Letter',
  verificationCode: 'Verification code',
  signed: 'Digitally signed',
  revoked: 'Revoked',
  download: 'Download PDF',
  letterPending: 'The letter is being produced. Check back in a few minutes.',

  history: 'History',
  issuedBy: (commission: string) => `Issued by ${commission}`,
  reminderSent: 'Reminder sent',
  duePassed: 'Due date passed',
  youResponded: 'You responded',
  youRespondedLate: (days: number) => `You responded (${plural(days, 'day')} late)`,
  furtherSentShort: 'Further clarification sent',
  resolvedShort: 'Resolved',
  withdrawnShort: 'Withdrawn: issued in error',
  responseDue: 'Response due',

  notFoundTitle: 'Clarification not found',
  notFoundBody: 'The link may be wrong, or it belongs to someone else.',
  unavailableTitle: 'We could not load this clarification',
  unavailableBody: 'Check your connection and try again in a few minutes.',
  tryAgain: 'Try again',
} as const;
