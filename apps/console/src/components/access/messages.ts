import { type AccessStatusMeta, accessStatusMeta, leaStatusMeta, plural } from '@adili/ui';

import type { QueueItem, QueueStatus } from '../../server/access/types';
import type { QueueFilter, QueueTab } from './queue-query';

/**
 * Copy of the Access requests workspace (spec 10 FE-5), from the console prototype
 * (`apps/console/prototype/10-access.prototype.html`). English; the Swahili slot (`sw`) stays empty
 * until EACC reviews translations (as `roster/messages.ts`).
 */
export const en = {
  title: 'Access requests',
  readOnly: 'Read only',
  tryAgain: 'Try again',
  forbidden: 'You do not have access to access requests.',

  // Queue
  tabs: { all: 'All', 'form-k': 'Form K', lea: 'Law enforcement' } satisfies Record<
    QueueTab,
    string
  >,
  kinds: { 'form-k': 'Form K', lea: 'Law enforcement' } satisfies Record<QueueItem['kind'], string>,
  searchLabel: 'Search requests',
  searchPlaceholder: 'Reference, name or file number',
  filtersLabel: 'Show',
  filters: {
    all: 'All',
    action: 'Needs action',
    window: 'Awaiting representations',
    late: 'Late',
    decided: 'Decided',
    closed: 'Closed',
  } satisfies Record<QueueFilter, string>,
  queueCaption: 'Access requests, earliest deadline first',
  queueLoadingCaption: 'Loading access requests',
  columnReference: 'Reference code',
  columnWho: {
    all: 'Applicant or agency',
    'form-k': 'Applicant',
    lea: 'Agency',
  } satisfies Record<QueueTab, string>,
  columnOfficer: 'Officer sought',
  columnStatus: 'Status',
  columnDeadline: 'Deadline',
  formK: 'Form K',
  fileNumber: (file: string) => `File ${file}`,
  soughtAs: (name: string) => `Sought as ${name}`,
  fileNumberInline: (file: string) => `file ${file}`,
  notIdentifiedYet: 'Not identified yet',
  notIdentified: 'Not identified',
  decisionDue: 'Decision due',
  representationsClose: 'Representations close',
  dueOn: (date: string) => `Due ${date}`,
  closesOn: (date: string) => `Closes ${date}`,
  decidedOn: (date: string) => `Decided ${date}`,
  closedOn: (date: string) => `Closed ${date}`,
  queueErrorTitle: 'We could not load the queue',
  queueErrorDetail: 'The access service did not answer. Try again in a moment.',
  emptyTitle: 'No requests yet',
  emptyText: {
    all: 'Form K and law enforcement requests to your Commission appear here.',
    'form-k': 'Form K requests to your Commission appear here.',
    lea: 'Law enforcement requests to your Commission appear here.',
  } satisfies Record<QueueTab, string>,
  noMatchesTitle: 'No matches',
  noMatchesText: 'No requests match these filters.',
  clearFilters: 'Clear filters',
  pagination: 'Access requests pages',
  pageRange: (from: number, to: number) => `Showing ${String(from)}-${String(to)} requests`,
  pageRows: (count: number) => `Showing ${plural(count, 'request')}`,
  previousPage: 'Previous page',
  nextPage: 'Next page',

  // Request page
  notFoundTitle: 'Request not found',
  notFoundText: 'The link may be wrong, or the request belongs to another Commission.',
  backToRequests: 'Back to access requests',
  requestErrorTitle: 'We could not load this request',
  requestErrorDetail: 'The access service did not answer. Try again in a moment.',
  receivedLine: (applicant: string, date: string) => `${applicant} · received ${date}`,
  formKTitle: 'Form K',
  declaredAt: (dateTime: string) => `Declared ${dateTime}`,
  partI: 'Part I · Applicant',
  partII: 'Part II · Officer sought',
  partIII: 'Part III · Information sought',
  scopeRequested: 'Scope requested',
  partIV: 'Part IV · Declaration',
  declarationTitle: 'Declaration',
  name: 'Name',
  identity: 'Identity',
  occupation: 'Occupation',
  telephone: 'Telephone',
  email: 'Email',
  postalAddress: 'Postal address',
  physicalAddress: 'Physical address',
  entity: 'Entity',
  workStation: 'Work station',
  personnelFileNumber: 'Personnel file number',
  notGiven: 'Not given',
  information: 'Information',
  reason: 'Reason',
  otherInformation: 'Other information',
  years: 'Years',
  people: 'People',
  sections: 'Sections',
  clarifications: 'Clarifications',
  included: 'Included',
  notIncluded: 'Not included',
  officerOnly: 'Officer only',
  officerAndSpouses: 'Officer and spouses',
  officerAndChildren: 'Officer and children',
  officerSpousesChildren: 'Officer, spouses and children',
  nationalId: (number: string) => `National ID ${number}`,
  passport: (number: string, country: string) => `Passport ${number} (${country})`,
  iprsMatch: 'IPRS match',
  verifiedByOfficer: 'Verified by officer',
  pendingVerification: 'Pending verification',
  registerTitle: 'Activity',
  whereItStands: 'Where the request stands',
  registerLabel: 'Request activity',

  // Verify applicant identity
  verifyTitle: 'Verify applicant identity',
  passportLabel: 'Passport',
  phoneLabel: 'Phone',
  confirmedByCode: 'confirmed by code',
  particularsChecked: 'Particulars checked against the passport',
  verifyNote: 'Note',
  verifyNotePlaceholder: 'How you checked, e.g. copy seen by email',
  verifyNoteHint: 'Recorded with the verification. Do not copy the passport number here.',
  verifyNoteRequired: 'Say how you checked the particulars.',
  verifyNoteTooLong: 'Keep the note to 1,000 characters.',
  checkRequired: 'Confirm you checked the particulars against the passport.',
  recordVerification: 'Record verification',
  verified: 'Applicant verified. Identify the officer next.',
  waitingVerification: 'Waiting for the access officer to verify the passport particulars.',

  // Identify officer
  identifyTitle: 'Identify officer',
  formKNames: 'Form K names',
  rosterSearchLabel: 'Search the roster by name or file number',
  rosterSearchPlaceholder: 'Name or file number',
  rosterSearchHint: 'At least 2 characters.',
  rosterResults: 'Roster records',
  searching: 'Searching the roster',
  noRosterMatch: 'No roster record matches. Try the personnel file number.',
  rosterSearchFailed: 'The roster could not be searched. Try again.',
  select: 'Select',
  selectRecord: (name: string) => `Select ${name}`,
  notOnboarded: 'Not onboarded',
  notOnboardedHint: 'No account yet: you serve the notice in writing.',
  notOnTheRoster: 'Not on the roster?',
  cannotIdentify: 'Cannot identify',
  waitingIdentify: 'Waiting for the access officer to identify the officer.',
  waitingIdentifyAfterVerify: 'The officer is identified once the applicant is verified.',

  // Resolve dialog
  identifyAs: (name: string) => `Identify as ${name}?`,
  resolveDeclarantNotified: 'The declarant is notified',
  resolveDeclarantNotifiedText: 'With the purpose in general terms and the requested scope.',
  resolveWindow: (date: string) => `Representations close ${date}`,
  resolveWindowText: (days: number) =>
    `${plural(days, 'day')} under the Commission's policy, or earlier if they consent.`,
  resolveWindowOpens: 'Their window for representations opens',
  resolveWindowUnknown:
    "As long as the Commission's policy sets, or until they consent. The closing date shows once they are notified.",
  resolveFinal: 'This cannot be changed',
  resolveInvited: 'They are invited to onboard',
  resolveInvitedText: 'By email and SMS, to the contacts on the roster.',
  resolveServeWritten: 'You serve the notice in writing',
  resolveServeWrittenText: 'Regulation 22(2). Their window runs from the day it was served.',
  cancel: 'Cancel',
  identifyAndNotify: 'Identify and notify',
  identifyOnly: 'Identify',
  identified: (name: string) => `${name} identified. The declarant is being notified.`,
  identifiedNoAccount: (name: string) => `${name} identified. Serve the notice in writing next.`,

  // Written notice (officer with no account)
  noticeTitle: 'Notify in writing',
  noticeIntro: (name: string) =>
    `${name} has no Adili account, so the notice goes on paper (Regulation 22(2)). Serve it with the purpose in general terms and the scope requested, then record the day it was served.`,
  invitedOn: (date: string) =>
    `Invited to onboard on ${date}. If they onboard first, they are notified online instead.`,
  invitePending: 'Being invited to onboard.',
  noticeDay: 'Day the notice was served',
  noticeDayPicker: 'Choose the day the notice was served',
  noticeDayHint: 'Not in the future, nor before the officer was identified.',
  noticeDayRequired: 'Enter the day the notice was served.',
  noticeDayInvalid: 'Enter a real date, as DD/MM/YYYY.',
  noticeDayFuture: 'The day cannot be in the future.',
  noticeDayEarly: (date: string) =>
    `The day cannot be before ${date}, when the officer was identified.`,
  noticeWindowPreview: (date: string) => `Representations will close at the end of ${date}.`,
  noticeWindowPassed: (date: string) =>
    `Representations closed at the end of ${date}: the request goes under decision at once.`,
  recordNotice: 'Record written notice',
  noticeRecorded: 'Written notice recorded. The window for representations is open.',
  waitingNotice: 'Waiting for the access officer to record the written notice.',

  // Written notice of the decision (officer with no account)
  decisionNoticeTitle: 'Tell the decision in writing',
  decisionNoticeIntro: (name: string) =>
    `${name} has no Adili account, so they cannot be told the decision online. Serve the decision and its reasons on paper, then record the day it was served.`,
  decisionNoticeDayEarly: (date: string) =>
    `The day cannot be before ${date}, when the decision was taken.`,
  decisionNoticeDayHint: 'Not in the future, nor before the decision.',
  decisionInvitedOn: (date: string) =>
    `Invited to onboard on ${date}. If they onboard, they are also told the decision online.`,
  decisionNoticeRecorded: 'Written notice of the decision recorded.',
  waitingDecisionNotice:
    'Waiting for the access officer to record the decision served in writing on the declarant.',
  decisionToldTerm: 'Told the decision',

  // Cannot identify dialog
  cannotTitle: 'Cannot identify the officer?',
  cannotCloses: 'The request closes as Cannot identify officer',
  cannotApplicantTold: 'The applicant is told',
  cannotApplicantToldText: 'By email and SMS, with a link to their request.',
  cannotFormM: 'Counted as declined in Form M',
  cannotFormMText: 'Reason: other.',
  closeRequest: 'Close request',
  closed: 'Request closed. The applicant has been told.',

  // Officer identified
  officerIdentified: 'Officer identified',
  declarant: 'Declarant',
  notified: 'Notified',
  notifying: 'Notifying the declarant…',
  declarantAccount: 'Declarant account',
  accountNone: 'Not onboarded',
  accountInvited: (date: string) => `Invited to onboard ${date}`,
  awaitingNotice: 'Awaiting written notice',
  notifiedInWriting: (date: string) => `In writing, served ${date}`,
  recordedBy: (name: string, at: string) => `Recorded by ${name} · ${at}`,

  // Decision side card
  decisionTitle: 'Decision',
  decisionOpensWhen: (date: string) =>
    `Opens when representations close on ${date}, or earlier if the declarant consents.`,
  decisionOpen: 'Representations are closed. Decide before the deadline.',
  decisionReadOnly: 'Only the access officer decides.',
  decide: 'Decide',

  // Closed side card
  closedTitle: 'Closed',
  cannotIdentifyOutcome: 'Cannot identify officer',
  cannotIdentifyBy: (name: string, at: string) => `${name} · ${at}. Applicant notified.`,
  withdrawnOutcome: 'Withdrawn',
  withdrawnBy: (at: string) => `By the applicant · ${at}`,

  // Representations
  representationsTitle: 'Representations',
  stance: { object: 'Object', consent: 'Consent', context: 'Add context' },
  edited: (at: string) => `Edited ${at}`,
  noneYet: (date: string) => `No representations yet. The window closes ${date}.`,
  noneReceived: (date: string) => `None received. The window closed ${date}.`,
  consentClosedEarly: 'Consent closed the window early.',
  receivedInWriting: 'Received in writing',
  enteredBy: (name: string) => `Entered by ${name}`,
  enterWritten: 'Enter representations received in writing',
  updateWritten: 'Update from a new letter',
  writtenTitle: 'Representations received in writing',
  writtenIntro:
    'Enter what the declarant answered on paper, with scans of the letter. They show as received in writing, with you as who entered them.',
  stanceLegend: 'The declarant',
  stanceHint: {
    object: 'Objects to the disclosure.',
    consent: 'Consents: the request goes under decision at once.',
    context: 'Adds context for the decision.',
  },
  writtenText: 'Representations',
  writtenTextHint: 'As the letter puts them. Optional with consent.',
  writtenTextRequired: 'Enter the representations, or choose Consent.',
  writtenTextTooLong: 'Keep the representations to 8,000 characters.',
  writtenScans: 'Scans of the letter',
  addScan: 'Add a scan',
  scansPending: 'Wait for the scans to finish uploading, or remove the ones that failed.',
  stanceRequired: 'Choose what the declarant says.',
  saveWritten: 'Save representations',
  writtenSaved: 'Representations saved as received in writing.',
  writtenReplaces: 'These replace the representations shown now.',
  attachmentsLabel: 'Attachments',
  attachmentActions: (name: string) => `Actions for ${name}`,
  download: 'Download',
  scannedClean: 'Scanned clean',
  attachmentFailed: 'The attachment could not be opened. Try again.',
  auditNote: 'Opening an attachment is recorded in the audit trail.',

  // Action failures
  sessionEnded: 'Your session has ended. Sign in again.',
  supervisorCannotAct: 'Only the access officer can do this.',
  stale: 'This request has changed. Reload to see it.',
  officerResolved: 'The officer is already identified. The page shows it now.',
  requestClosed: 'The request is closed. The page shows it now.',
  requestDecided: 'The request is decided. The page shows it now.',
  notPendingVerification: 'The applicant is verified already. The page shows it now.',
  declarantNotified: 'The declarant is notified already. The page shows it now.',
  representationsClosed: 'The window for representations has closed. The page shows it now.',
  rosterRecordProblem: "That record is not on the Commission's roster. Search again.",
  directoryUnavailable: 'The roster cannot be reached right now. Nothing was recorded. Try again.',
  saveFailed: 'We could not save this. Try again.',
};

/**
 * The queue badge's word and tone for each status, from the shared access table: Form K in
 * staff words, law enforcement requests in the words their officer reads too. A received law
 * enforcement request waits on the access officer, so it is marked as an action.
 */
export const STATUS: Record<QueueStatus, AccessStatusMeta> = {
  ...accessStatusMeta,
  received: { ...leaStatusMeta.received, tone: 'warning' },
  verified: leaStatusMeta.verified,
};

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
