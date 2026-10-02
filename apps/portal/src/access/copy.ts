import { formatDate, type IconProps, plural, type Tone } from '@adili/ui';
import {
  BalanceScaleIcon,
  CheckListIcon,
  Notification01Icon,
  SentIcon,
  Tick02Icon,
  UnavailableIcon,
  Undo02Icon,
  UserRemove01Icon,
  UserSearch01Icon,
  UserQuestion01Icon,
} from '@hugeicons/core-free-icons';

import { en, english, type Label, type Phrase } from '../declaration/translatable';
import type { AccessRequestStatus, Ground } from '../server/access/types';

/**
 * Words for the applicant's access requests (spec 10 FE-3): the Form K wizard, My requests and
 * a request's page. Statuses and grounds are keyed by the contract's types, so a value the
 * contract adds is a type error here until it has words. English with an empty Swahili slot,
 * until the Swahili copy is done; screens read English.
 */

export interface StatusMeta {
  label: Label;
  tone: Tone;
  icon: IconProps['icon'];
}

/** Every status of a Form K request, as the applicant sees it. */
export const STATUSES = {
  submitted: { label: en('Submitted'), tone: 'info', icon: SentIcon },
  'pending-applicant-verification': {
    label: en('Awaiting identity verification'),
    tone: 'warning',
    icon: UserQuestion01Icon,
  },
  'officer-unresolved': {
    label: en('Officer being identified'),
    tone: 'info',
    icon: UserSearch01Icon,
  },
  'awaiting-representations': {
    label: en('Declarant notified'),
    tone: 'info',
    icon: Notification01Icon,
  },
  'under-decision': { label: en('Under decision'), tone: 'brand', icon: BalanceScaleIcon },
  granted: { label: en('Granted'), tone: 'success', icon: Tick02Icon },
  'partially-granted': { label: en('Partially granted'), tone: 'success', icon: CheckListIcon },
  denied: { label: en('Denied'), tone: 'destructive', icon: UnavailableIcon },
  'cannot-identify': {
    label: en('Cannot identify officer'),
    tone: 'default',
    icon: UserRemove01Icon,
  },
  withdrawn: { label: en('Withdrawn'), tone: 'default', icon: Undo02Icon },
} satisfies Record<AccessRequestStatus, StatusMeta>;

/** Regulation 24's grounds for refusing access, as the applicant reads them. */
export const GROUNDS = {
  'public-interest': en('Against the public interest (Regulation 24(a))'),
  'prejudice-proceeding': en(
    'May prejudice an ongoing proceeding or investigation (Regulation 24(b))',
  ),
  'frivolous-vexatious': en('Frivolous, vexatious or scandalous (Regulation 24(c))'),
  'not-objectives': en('Does not promote the objectives of the Act (Regulation 24(d))'),
} satisfies Record<Ground, Label>;

/** The Form K wizard's steps, in order: the nav label and the page heading. */
export const STEPS = {
  commission: { nav: en('Commission'), heading: en('Which Commission?') },
  particulars: { nav: en('Your particulars'), heading: en('Your particulars') },
  officer: { nav: en('Officer sought'), heading: en('Officer sought') },
  information: { nav: en('Information sought'), heading: en('Information sought') },
  scope: { nav: en('Scope'), heading: en('Scope') },
  declare: { nav: en('Declare'), heading: en('Check and declare') },
} satisfies Record<string, { nav: Label; heading: Label }>;

const count = (n: number) => n.toLocaleString('en');

const FORM_K = {
  newRequest: en('New request'),
  myRequests: en('My requests'),
  steps: en('Form K steps'),
  decisionWithin: en('Decision within 30 days'),
  back: en('Back'),
  continue: en('Continue'),
  submit: en('Submit request'),
  submitting: en('Submitting…'),
  edit: en('Edit'),
  editPart: en((part: string) => `Edit ${part}`),
  optional: en('Optional'),
  counter: en((used: number, max: number) => `${count(used)} / ${count(max)}`),

  commissionLabel: en('Responsible Commission'),
  commissionHint: en('The Commission that holds the officer’s declarations.'),
  commissionPlaceholder: en('Search, e.g. Teachers'),
  commissionNone: en('No Commission matches.'),
  commissionMissing: en('Choose the Commission.'),
  noYears: en(
    (name: string) =>
      `No declarations are available from ${name} yet. Try again after its first declaration period.`,
  ),

  fromAccount: en('From your account'),
  name: en('Name'),
  nationalId: en('National ID'),
  passport: en('Passport'),
  passportOf: en((country: string) => `Passport (${country})`),
  verified: en('Verified'),
  pendingVerification: en('Checked by the Commission'),
  telephone: en('Telephone'),
  email: en('Email'),
  postalAddress: en('Postal address'),
  physicalAddress: en('Physical address'),
  occupation: en('Occupation'),
  postalMissing: en('Enter your postal address.'),
  physicalMissing: en('Enter your physical address.'),
  addressTooLong: en('Keep this to 200 characters or fewer.'),
  occupationMissing: en('Enter your occupation.'),
  occupationTooLong: en('Keep this to 100 characters or fewer.'),

  officerHint: en(
    'As precisely as you can. The Commission must identify the officer on its roster.',
  ),
  officerName: en('Name'),
  officerNameMissing: en('Enter the officer’s full name.'),
  entity: en('Entity'),
  entityHint: en('The ministry, department, agency or county they work for.'),
  entityMissing: en('Enter the entity the officer works for.'),
  workStation: en('Work station'),
  fileNumber: en('Personnel file number'),
  fileNumberHint: en('Only if you know it.'),
  fileNumberTooLong: en('Keep this to 30 characters or fewer.'),
  officerTooLong: en('Keep this to 200 characters or fewer.'),

  informationSought: en('Information you want'),
  informationMissing: en('Describe the information you want (at least 10 characters).'),
  reason: en('Reason for requiring it'),
  reasonHint: en(
    'Your legitimate interest and good cause (Act s.36(1)). The Commission weighs it against the officer’s privacy.',
  ),
  reasonMissing: en('Give your reason (at least 10 characters).'),
  otherInformation: en('Other information'),
  textTooLong: en('Keep this to 4,000 characters or fewer.'),

  scopeHint: en('Ask only for what your interest requires. The Commission may grant less.'),
  yearsMissing: en('Choose at least one declaration year.'),
  sectionsMissing: en('Choose at least one section.'),

  partCommission: en('Commission'),
  years: en('Years'),
  people: en('People'),
  theDeclarant: en('The declarant'),
  spouses: en('Spouses'),
  children: en('Children'),
  sections: en('Sections'),
  declaration: en(
    'I declare that the information I have given above is true, complete and correct to the best of my knowledge.',
  ),
  declaredBy: en((date: string, name: string) => `${date} · ${name}`),
  declareMissing: en('Tick the declaration to submit your request.'),

  rejectedTitle: en('Your request was not submitted.'),
  rejectedText: en('Fix the highlighted field and submit again.'),
  unavailableTitle: en('Your request was not submitted.'),
  unavailableText: en(
    'We could not reach the Commission’s service. Your answers are still here: try again in a few minutes.',
  ),
  sessionEnded: en('Your session has ended. Sign in again to submit your request.'),
  signIn: en('Sign in'),
  loadUnavailableTitle: en('We could not start a new request'),
  loadUnavailableText: en('Reload the page, or try again in a few minutes.'),
};

export const FORM_K_COPY = english(FORM_K);

const REQUESTS = {
  title: en('My requests'),
  newRequest: en('New request'),
  emptyTitle: en('No requests yet'),
  emptyText: en('Ask to see a public officer’s declaration.'),
  unavailableTitle: en('We could not load your requests'),
  unavailableText: en('Reload the page, or try again in a few minutes.'),
  notApplicantTitle: en('Access requests are for applicants'),
  notApplicantText: en(
    'This account is not set up to request access to declarations. Create an applicant account to make a request.',
  ),
  getStarted: en('Get started as an applicant'),
  pagination: en('Pages of requests'),
  range: en((from: number, to: number, total: number) =>
    from === to ? `${from} of ${total}` : `${from}-${to} of ${total}`,
  ),
  previous: en('Previous page'),
  next: en('Next page'),
  page: en((n: number) => `Page ${n}`),
  submittedOn: en((date: string) => `Submitted ${date}`),
  decidedOn: en((date: string) => `Decided ${date}`),
  withdrawnOn: en((date: string) => `Withdrawn ${date}`),
  closedOn: en((date: string) => `Closed ${date}`),
  decisionDue: en('Decision due'),
  dueOn: en((date: string) => `Decision due ${date}`),
  open: en((reference: string) => `Open request ${reference}`),
  downloadBy: en('Download by'),
  expiresToday: en('Expires today'),
  downloadExpired: en('Download expired'),
};

export const REQUESTS_COPY = english(REQUESTS);

const REQUEST = {
  back: en('My requests'),
  yourRequest: en('Your request'),
  officer: en('Officer'),
  entity: en('Entity'),
  workStation: en('Work station'),
  fileNumber: en('Personnel file number'),
  informationSought: en('Information sought'),
  reason: en('Reason'),
  otherInformation: en('Other information'),
  scope: en('Scope'),
  progress: en('Progress'),
  decisionDueIn: en((days: number) =>
    days === 0 ? 'Decision due today' : `Decision due in ${plural(days, 'day')}`,
  ),
  decisionLate: en((days: number) => `Decision ${plural(days, 'day')} late`),
  decisionDayOf: en((date: string, day: number, of: number) => `Due ${date} · day ${day} of ${of}`),
  decisionClock: en('Decision clock'),
  withdraw: en('Withdraw request'),
  withdrawTitle: en('Withdraw this request?'),
  withdrawStops: en((commission: string) => `${commission} stops working on`),
  withdrawCloses: en('and closes it. You cannot undo this.'),
  withdrawAgain: en('To ask again, make a new request.'),
  cancel: en('Cancel'),
  withdrawing: en('Withdrawing…'),
  withdrawn: en('Request withdrawn'),
  withdrawUnavailable: en('We could not withdraw the request. Try again in a few minutes.'),
  decidedTitle: en('Already decided'),
  decidedText: en(
    (commission: string) =>
      `${commission} decided this request before you withdrew it, so it cannot be withdrawn.`,
  ),
  closedTitle: en('Already closed'),
  closedText: en('This request is already closed, so there is nothing to withdraw.'),
  seeRequest: en('See the request'),
  notFoundTitle: en('We could not find this request'),
  notFoundText: en('It may belong to another account. Your requests are listed in My requests.'),
  unavailableTitle: en('We could not load this request'),
  unavailableText: en('Reload the page, or try again in a few minutes.'),
  newWithDetails: en('New request with these details'),
  decision: en('Decision'),
  outcome: en('Outcome'),
  grounds: en('Grounds (Regulation 24)'),
  reasons: en('Reasons'),
  grantedScope: en('Granted'),
  courtRelief: en('If you disagree with the decision, you may seek relief from the court.'),

  received: en('Received'),
  receivedDetail: en((at: string) => `${at} · acknowledged by SMS and email`),
  passportCheck: en('Passport verification'),
  passportWaiting: en((commission: string) => `Waiting for ${commission}`),
  officerIdentified: en('Officer identified'),
  officerChecking: en((commission: string) => `${commission} is checking its roster`),
  officerNotIdentified: en('Officer could not be identified'),
  officerNotified: en('Officer notified'),
  officerNotifiedFuture: en('They get 7 days to respond'),
  officerResponding: en('They can respond before the decision'),
  decided: en('Decision'),
  decisionDueOn: en((date: string) => `Due ${date}`),
  withdrawnStep: en('Withdrawn'),
};

export const REQUEST_COPY = english(REQUEST);

const PACKAGE = {
  title: en('Package'),
  confidential: en('Confidential'),
  issuedOn: en((date: string) => `Issued to you on ${date}.`),
  watermarked: en('Your name and reference are on every page.'),
  download: en('Download'),
  expiresOn: en((at: string, days: number) => `Expires ${at} · ${plural(days, 'day')} left`),
  expiresIn: en((left: string) => `Expires in ${left}`),
  spokenHours: en((hours: number) => `Expires in ${plural(hours, 'hour')}`),
  spokenMinutes: en((minutes: number) => `Expires in ${plural(minutes, 'minute')}`),
  downloaded: en(
    (times: number, last: string) => `Downloaded ${plural(times, 'time')} · last ${last}`,
  ),
  notDownloaded: en('Not downloaded yet'),
  expiredOn: en((date: string) => `Expired ${date}`),
  stillNeed: en((commission: string) => `Contact ${commission} if you still need it.`),
  offence: en(
    (commission: string) =>
      `Publishing or sharing it without ${commission}’s permission is an offence (Act\u00a0s.36(4)).`,
  ),
  downloadFailed: en('We could not start the download. Try again.'),
  downloadStarted: en('Download started. Each download is recorded.'),
  preparingTitle: en('Preparing your package…'),
  preparingText: en('Usually a few minutes. We will SMS and email you when it is ready.'),

  readyNext: en((at: string) => `Download your package by ${at}.`),
  readyTodayNext: en((time: string) => `Download your package today, by ${time}.`),
  partialReadyNext: en(
    (at: string) => `Some of what you asked for was not granted. Download your package by ${at}.`,
  ),
  partialReadyTodayNext: en(
    (time: string) =>
      `Some of what you asked for was not granted. Download your package today, by ${time}.`,
  ),
  preparingNext: en('Your package is being prepared.'),
  closedNext: en((date: string) => `The download window closed on ${date}.`),
  closedNowLead: en('The download window has closed.'),
  closedNowNext: en('The package can no longer be downloaded.'),

  stagePreparing: en('Package'),
  stagePreparingDetail: en('Being prepared'),
  stageReady: en('Package ready'),
  stageReadyDetail: en((at: string) => `Until ${at}`),
  stageClosed: en('Download window closed'),
};

export const PACKAGE_COPY = english(PACKAGE);

type BannerPhrase = Phrase<[commission: string, date: string]>;

/**
 * The banner at the top of a request's page: a bold lead and what happens next. Both take the
 * Commission's name and the date that matters in that status: the receipt, the decision due
 * date, or when it was withdrawn.
 */
export const STATUS_BANNERS: Record<
  AccessRequestStatus,
  { lead: BannerPhrase; next: BannerPhrase }
> = {
  submitted: {
    lead: en(
      (commission: string, date: string) => `${commission} received your request on ${date}.`,
    ),
    next: en(() => 'Next, it identifies the officer on its roster.'),
  },
  'pending-applicant-verification': {
    lead: en((commission: string) => `Waiting for ${commission} to verify your passport.`),
    next: en(() => 'Your request moves on once it is verified.'),
  },
  'officer-unresolved': {
    lead: en((commission: string) => `${commission} is identifying the officer on its roster.`),
    next: en(() => 'It notifies the officer once they are identified.'),
  },
  'awaiting-representations': {
    lead: en((commission: string) => `${commission} has notified the officer.`),
    next: en((commission: string) => `They can respond before ${commission} decides.`),
  },
  'under-decision': {
    lead: en((commission: string) => `${commission} is deciding.`),
    next: en((_commission: string, date: string) => `It must decide by ${date}.`),
  },
  granted: {
    lead: en((commission: string) => `${commission} granted your request.`),
    next: en(() => 'The decision and its reasons are below.'),
  },
  'partially-granted': {
    lead: en((commission: string) => `${commission} granted part of your request.`),
    next: en(() => 'What was granted, and why, is below.'),
  },
  denied: {
    lead: en((commission: string) => `${commission} denied your request.`),
    next: en(() => 'The reasons are below. You may seek relief from the court.'),
  },
  'cannot-identify': {
    lead: en(
      (commission: string) =>
        `${commission} could not identify this officer on its roster, so the request is closed.`,
    ),
    next: en(() => 'Check the officer’s details and make a new request.'),
  },
  withdrawn: {
    lead: en((_commission: string, date: string) => `You withdrew this request on ${date}.`),
    next: en(() => 'To ask again, make a new request.'),
  },
};

const SUBMITTED = {
  title: en('Request submitted'),
  acknowledged: en(
    (date: string) =>
      `Acknowledged ${date}. The Commission has 30 days to decide. You will be notified.`,
  ),
  passport: en(
    'Your identity will be verified by the Commission before it starts. The 30 days run from today.',
  ),
  view: en('View request'),
  myRequests: en('My requests'),
};

export const SUBMITTED_COPY = english(SUBMITTED);

export const ACCESS_SHELL_COPY = english({
  nav: en('Access requests'),
  myRequests: en('My requests'),
  newRequest: en('New request'),
});

/** `26 Sep 2026` */
export const day = (iso: string) => formatDate(iso);
