import { plural } from '@adili/ui';

import { en, english } from '../declaration/translatable';
import type { Outcome, RepresentationStance } from '../server/access/types';

/**
 * Words for the requests someone made to see the declarant's declaration (spec 10 FE-4): the
 * Access requests card on Home, the list, a request's page and the response form. Stances and
 * outcomes are keyed by the contract's types, so a value the contract adds is a type error here
 * until it has words. English with an empty Swahili slot until the Swahili copy is done.
 */

const NOTICES = {
  card: en('Access requests'),
  viewAll: en('View all'),
  title: en('Access requests'),
  home: en('Home'),
  open: en('Open'),
  earlier: en('Earlier'),
  all: en('All access requests'),
  emptyTitle: en('No access requests'),
  emptyText: en('If someone asks to see your declaration, we will SMS and email you.'),
  unavailableTitle: en('We could not load your access requests'),
  unavailableText: en('Reload the page, or try again in a few minutes.'),
  tryAgain: en('Try again'),

  someone: en('Someone has requested access to your declaration'),
  from: en((applicant: string) => `Access request from ${applicant}`),
  lea: en(
    (date: string, agency: string) =>
      `A law-enforcement agency was granted access on ${date} (${agency})`,
  ),
  leaCase: en(
    (date: string, agency: string, caseReference: string) =>
      `A law-enforcement agency was granted access on ${date} (${agency}, case ${caseReference})`,
  ),
  notifiedOn: en((date: string) => `Notified ${date}`),
  decidedOn: en((date: string) => `Decided ${date}`),
  respondBy: en((date: string) => `Respond by ${date}`),
  editUntil: en((date: string) => `Edit until ${date}`),
  left: en((days: number) =>
    days <= 0 ? 'closes today' : days === 1 ? '1 day left' : `${String(days)} days left`,
  ),
  openRequest: en((reference: string) => `Open access request ${reference}`),

  statusAwaiting: en('Waiting for your response'),
  statusSaved: en('Response saved'),
  statusUnderDecision: en('Under decision'),
  statusWithdrawn: en('Withdrawn'),
  statusClosed: en('Closed'),
  statusLea: en('Law enforcement'),

  you: en('You'),
  spouses: en('spouse'),
  children: en('children'),
  youAnd: en((others: string) => `You and ${others}`),
  youSpouseChildren: en('You, spouse and children'),
  youOnly: en('You only'),
};

export const NOTICES_COPY = english(NOTICES);

const NOTICE = {
  back: en('Access requests'),
  pageTitle: en('Access request'),
  leaTitle: en('Law-enforcement access'),
  notified: en((date: string) => `Notified ${date}`),
  granted: en((date: string) => `Granted ${date}`),

  bannerNotice: en('Someone has requested access to your declaration.'),
  bannerNoticeNext: en(
    (date: string, commission: string) => `Respond by ${date}. ${commission} decides after that.`,
  ),
  bannerSaved: en('Your response is saved.'),
  bannerSavedNext: en((date: string) => `You can edit it until ${date}.`),
  bannerConsented: en('You consented.'),
  bannerConsentedNext: en(
    (commission: string) => `${commission} can now decide. We will SMS and email you the outcome.`,
  ),
  bannerClosed: en((date: string) => `The window closed on ${date}.`),
  bannerClosedWithResponse: en(
    (commission: string) => `${commission} has your response and is deciding.`,
  ),
  bannerClosedNoResponse: en(
    (commission: string) => `You did not respond. ${commission} is deciding.`,
  ),
  bannerConflict: en('The window has closed.'),
  bannerConflictNext: en(
    (commission: string) => `Your response was not saved. ${commission} is deciding.`,
  ),
  bannerWithdrawn: en('The applicant withdrew the request.'),
  bannerWithdrawnNext: en('Nothing was released.'),
  bannerDecided: en(
    (commission: string, verb: string, date: string) => `${commission} ${verb} on ${date}.`,
  ),
  whyNow: en('Why now'),
  leaWhyNow: en(
    'Law-enforcement requests are shown after access is granted, so investigations are not prejudiced.',
  ),

  request: en('Request'),
  applicant: en('Applicant'),
  agency: en('Agency'),
  commission: en('Commission'),
  purpose: en('Purpose'),
  scopeAsked: en('Scope asked'),
  scopeAskedAndGranted: en('Scope asked and granted'),
  scopeGranted: en('Scope granted'),
  years: en('Declaration year'),
  people: en('People'),
  sections: en('Sections'),
  you: en('You'),
  spouse: en('Spouse'),
  children: en('Children'),
  withheld: en('Withheld'),
  notReleased: en('not released'),
  notAsked: en('not asked'),

  decision: en('Decision'),
  grounds: en('Grounds'),
  reasons: en('Reasons'),

  window: en('Window for your response'),
  daysLeft: en((days: number) =>
    days <= 0 ? 'Closes today' : days === 1 ? '1 day left' : `${String(days)} days left`,
  ),
  closedEarly: en('Closed early'),
  windowClosed: en('Window closed'),
  windowOpenDetail: en(
    (verb: string, at: string, day: number, of: number) =>
      `${verb} ${at} · day ${String(day)} of ${String(of)}`,
  ),
  respondByVerb: en('Respond by'),
  editUntilVerb: en('Edit until'),
  consentedOn: en((date: string) => `You consented on ${date}`),
  closedAt: en((at: string) => `Closed ${at}`),
  daysUsed: en((day: number, of: number) => `${String(day)} of ${String(of)} days used`),

  history: en('History'),
  askedToSee: en((who: string) => `${who} asked to see your declaration`),
  notifiedBy: en((commission: string) => `Notified by ${commission}`),
  youEdited: en('You · edited'),
  officerOf: en((commission: string) => `Access officer, ${commission}`),
  agencyGranted: en((agency: string) => `${agency} was granted access`),

  notFoundTitle: en('Access request not found'),
  notFoundText: en('The link may be wrong, or it is not about your declaration.'),
  allRequests: en('All access requests'),
  unavailableTitle: en('We could not load this access request'),
  unavailableText: en('Reload the page, or try again in a few minutes.'),
  tryAgain: en('Try again'),
};

export const NOTICE_COPY = english(NOTICE);

const RESPONSE = {
  title: en('Your response'),
  position: en('Your position'),
  stanceMissing: en('Choose object, consent or add context.'),
  optional: en('Optional'),
  counter: en(
    (used: number, max: number) => `${used.toLocaleString('en')} / ${max.toLocaleString('en')}`,
  ),
  objectLabel: en('Your reasons'),
  contextLabel: en((commission: string) => `Context for ${commission}`),
  consentLabel: en('Comments'),
  objectPlaceholder: en('Why the declaration should not be released'),
  contextPlaceholder: en('What the Commission should know before deciding'),
  consentPlaceholder: en('Anything you want to add'),
  objectMissing: en('Write your reasons.'),
  contextMissing: en('Write the context you want the Commission to consider.'),
  tooLong: en(
    (max: number) => `Keep your response to ${max.toLocaleString('en')} characters or fewer.`,
  ),
  documents: en('Documents with your response'),
  attach: en('Attach a document'),
  attachAnother: en('Attach another document'),
  attachHint: en('Optional. PDF, JPEG, PNG or HEIC, up to 20 MB each.'),
  attachLimit: en((max: number) => `Up to ${String(max)} documents.`),
  removeBody: en('It will not be sent with your response.'),
  editableUntil: en((date: string) => `Editable until ${date}`),
  cancel: en('Cancel'),
  send: en('Send response'),
  saveChanges: en('Save changes'),
  saving: en('Saving…'),
  checkingFiles: en('Checking files…'),
  networkError: en('We could not save your response. Check your connection and try again.'),
  signedOut: en('Your session has ended. Sign in again, then send your response.'),
  signIn: en('Sign in'),
  checkBeforeSend: en('Check your response before you send it.'),
  filesStillChecking: en('Wait until your documents have been checked.'),
  filesNotAccepted: en('Remove the documents that were not accepted before you send.'),
  attachmentRefused: en('A document was not accepted. Remove it and attach it again.'),
  sentFirst: en(
    (commission: string, date: string) =>
      `Response sent to ${commission}. You can edit it until ${date}.`,
  ),
  sentConsent: en((commission: string) => `Consent sent to ${commission}.`),
  changesSaved: en('Changes saved.'),
  edit: en('Edit'),
  sentAt: en((at: string) => `Sent ${at}`),
  editedAt: en((at: string) => `Edited ${at}`),

  consentTitle: en('Consent to release?'),
  consentBody: en(
    (commission: string) =>
      `${commission} can decide straight away. You cannot change your response after this.`,
  ),
  consentApplicant: en('Applicant'),
  consentScope: en('Scope asked'),
  consentConfirm: en('Consent and send'),
  sending: en('Sending…'),
};

export const RESPONSE_COPY = english(RESPONSE);

/** Each stance: the choice, its hint, and how a sent response reads. */
export const STANCES = {
  object: { label: en('Object'), hint: en('Ask not to release it'), done: en('You objected') },
  consent: { label: en('Consent'), hint: en('Agree to release'), done: en('You consented') },
  context: {
    label: en('Add context'),
    hint: en('Tell the Commission first'),
    done: en('You added context'),
  },
} satisfies Record<RepresentationStance, { label: unknown; hint: unknown; done: unknown }>;

/** Each outcome as the declarant reads it: the badge, and what the Commission did. */
export const OUTCOMES = {
  grant: {
    label: en('Granted'),
    verb: en('granted access'),
    released: en('What was asked was released.'),
  },
  'partial-grant': {
    label: en('Partially granted'),
    verb: en('partially granted access'),
    released: en('Only part of what was asked was released.'),
  },
  deny: { label: en('Denied'), verb: en('denied access'), released: en('Nothing was released.') },
} satisfies Record<Outcome, { label: unknown; verb: unknown; released: unknown }>;

/** `3 documents` */
export const documents = (n: number) => plural(n, 'document');
