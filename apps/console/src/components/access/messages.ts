import { plural } from '@adili/ui';

import type { QueueItem, QueueStatus } from '../../server/access/types';
import type { QueueFilter, QueueTab } from './queue-query';

/**
 * Copy of the Access requests workspace (spec 10 FE-5), from the console prototype
 * (`apps/console/prototype/10-access.prototype.html`). English only; the Swahili slot stays empty
 * until the console has a convention for it (as `roster/messages.ts`).
 */
export const en = {
  title: 'Access requests',
  readOnly: 'Read only',
  tryAgain: 'Try again',
  backToOverview: 'Back to overview',
  forbidden: 'You do not have access to access requests.',
  accessErrorTitle: 'We could not load your access',
  accessErrorDetail: 'Check your connection and try again.',

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
  columnReference: 'Reference',
  columnWho: {
    all: 'Applicant or agency',
    'form-k': 'Applicant',
    lea: 'Agency',
  } satisfies Record<QueueTab, string>,
  columnOfficer: 'Officer',
  columnStatus: 'Status',
  columnDeadline: 'Deadline',
  formK: 'Form K',
  fileNumber: (file: string) => `File ${file}`,
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
  registerTitle: 'Register',
  whereItStands: 'Where the request stands',
  registerLabel: 'Access register',

  // Verify applicant
  verifyTitle: 'Verify applicant',
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
  notOnboardedHint: 'Has no declarant account to be notified on yet.',
  notOnTheRoster: 'Not on the roster?',
  cannotIdentify: 'Cannot identify',
  waitingIdentify: 'Waiting for the access officer to identify the officer.',
  waitingIdentifyAfterVerify: 'The officer is identified once the applicant is verified.',

  // Resolve dialog
  identifyAs: (name: string) => `Identify as ${name}?`,
  resolveDeclarantNotified: 'The declarant is notified',
  resolveDeclarantNotifiedText: 'With the purpose in general terms and the requested scope.',
  resolveWindow: (date: string) => `Representations close ${date}`,
  resolveWindowText: '7 days, or earlier if they consent.',
  resolveFinal: 'This cannot be changed',
  cancel: 'Cancel',
  identifyAndNotify: 'Identify and notify',
  identified: (name: string) => `${name} identified. The declarant is being notified.`,

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
  notified: 'Notified',
  notifying: 'Notifying the declarant…',

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
  attachmentsLabel: 'Attachments',
  openAttachment: (name: string) => `Download ${name}`,
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
  notOnboardedProblem:
    'The officer has not onboarded, so they cannot be notified. Choose an onboarded record or close the request.',
  directoryUnavailable: 'The roster cannot be reached right now. Nothing was recorded. Try again.',
  saveFailed: 'We could not save this. Try again.',
};

/** The queue badge's word and tone for each status, as the prototype's `FK` table. */
export const STATUS: Record<
  QueueStatus,
  { label: string; tone: 'default' | 'info' | 'brand' | 'success' | 'warning' | 'destructive' }
> = {
  submitted: { label: 'Submitted', tone: 'info' },
  'pending-applicant-verification': { label: 'Verify applicant', tone: 'warning' },
  'officer-unresolved': { label: 'Identify officer', tone: 'warning' },
  'awaiting-representations': { label: 'Awaiting representations', tone: 'default' },
  'under-decision': { label: 'Under decision', tone: 'brand' },
  granted: { label: 'Granted', tone: 'success' },
  'partially-granted': { label: 'Partially granted', tone: 'success' },
  denied: { label: 'Denied', tone: 'destructive' },
  'cannot-identify': { label: 'Cannot identify officer', tone: 'default' },
  withdrawn: { label: 'Withdrawn', tone: 'default' },
  // Law enforcement requests, as the access officer works them: verify, then decide.
  received: { label: 'Verify', tone: 'warning' },
  verified: { label: 'Under decision', tone: 'brand' },
};

export const messages = en;
