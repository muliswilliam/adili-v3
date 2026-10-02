import { plural } from '@adili/ui';

/**
 * Copy of the Certified copies screens (spec 10 slice #302, in-person self-access), from the
 * console prototype (`apps/console/prototype/10-access.prototype.html`, #304). English, with an
 * empty Swahili slot (`sw`), as `access/messages.ts`; kept apart so the decision and law
 * enforcement screens do not collide.
 */
export const en = {
  title: 'Certified copies',
  workspaceTitle: 'Access requests',
  tabsLabel: 'Request types',
  tabCopies: 'Certified copies',
  tryAgain: 'Try again',
  readOnly: 'Read only',

  // List
  recordApplication: 'Record application',
  listCaption: 'Written self-access applications, earliest deadline first',
  listLoadingCaption: 'Loading applications',
  listErrorTitle: 'We could not load the applications',
  listErrorDetail: 'Check your connection and try again.',
  emptyTitle: 'No applications yet',
  emptyText:
    'When a declarant, or someone they authorised, applies in writing for a certified copy, record it here.',
  emptyTextReadOnly:
    'Written applications for certified copies recorded by the access officer show here.',
  columnDeclarant: 'Declarant',
  columnAppliedBy: 'Applied by',
  columnVersion: 'Version',
  columnStatus: 'Status',
  columnDeadline: 'Deadline',
  fileNumber: (file: string) => `File ${file}`,
  inPerson: 'In person',
  theDeclarant: 'The declarant',
  representative: 'Representative',
  versionLine: (version: number, delivery: 'collection' | 'dispatch') =>
    `Version ${String(version)} · ${delivery === 'collection' ? 'Collect' : 'Dispatch'}`,
  issueBy: 'Issue by',
  issueByOn: (date: string) => `Issue by ${date}`,
  issuedOn: (date: string) => `Issued ${date}`,
  collectedOn: (date: string) => `Collected ${date}`,
  dispatchedOn: (date: string) => `Dispatched ${date}`,
  pagination: 'Applications pages',
  pageRange: (from: number, to: number) => `${String(from)}-${String(to)}`,
  pageRows: (rows: number) => plural(rows, 'application'),
  previousPage: 'Previous page',
  nextPage: 'Next page',

  // States
  states: {
    preparing: 'Preparing',
    failed: 'Issue failed',
    ready: 'Ready',
    collected: 'Collected',
    dispatched: 'Dispatched',
  },
  selfAccess: 'Self-access',

  // Record form
  formTitle: 'Certified copy application',
  newCrumb: 'New application',
  formIntro:
    'For a declarant who applies in writing at the Commission, in person or through someone they authorised.',
  declarantTitle: 'Declarant',
  change: 'Change',
  changeDeclarant: 'Change the declarant',
  notOnboardedHint: 'Has no declarant account, so no declaration to copy.',
  declarantRequired: 'Find the declarant on the roster.',

  identityTitle: 'Identity check',
  whoApplied: 'Who applied?',
  whoDeclarant: 'The declarant, in person',
  whoRepresentative: 'A representative',
  documentSeen: 'Document seen',
  documentOnAuthority: "Declarant's ID on the authority",
  documents: {
    'national-id': 'National ID',
    passport: 'Passport',
    'service-card': 'Service card',
  },
  matchesRoster: 'The document matches the roster record',
  authorityMatchesRoster: "The declarant's details on the authority match the roster record",
  matchRequired: 'Confirm the check before you record the application.',
  note: 'Note',
  optional: 'Optional',
  notePlaceholder: 'Anything unusual',
  noteHint: 'No ID or document numbers here.',
  noteTooLong: 'Keep the note under 500 characters.',

  representativeTitle: 'Representative',
  repName: 'Full name',
  repNameHint: 'As on their ID',
  repNameRequired: "Enter the representative's full name.",
  repIdNumber: 'ID number',
  repIdNumberHint: 'National ID or passport number. Stored encrypted.',
  repIdNumberRequired: "Enter the representative's ID number.",
  authority: 'Written authority',
  authorityAdd: 'Upload authority',
  authorityRequired: 'Upload the written authority the declarant signed.',
  identification: "Representative's ID",
  identificationAdd: 'Upload ID copy',
  identificationRequired: "Upload a copy of the representative's ID.",
  proofHint: 'PDF, JPEG or PNG, up to 20 MB.',
  proofPending: 'Wait for the upload to finish.',
  proofMessages: {
    uploading: 'Uploading…',
    scanning: 'Checking for viruses…',
    linked: 'Scanned clean',
    infected: 'Failed the virus check. Upload another file.',
    'rejected-type': 'Use a PDF, JPEG or PNG file.',
    'rejected-size': 'This file is larger than 20 MB. Use a smaller file.',
    failed: 'The upload did not finish. Check your connection and try again.',
    removeTitle: (name: string) => `Remove ${name}?`,
    removeBody: 'The file will not be attached to the application. You can upload it again.',
    removeConfirm: 'Remove file',
    cancel: 'Cancel',
    retry: 'Try again',
    actions: (name: string) => `Actions for ${name}`,
    remove: 'Remove',
  },

  versionTitle: 'Version',
  versionLabel: 'Declaration version',
  chooseDeclarantFirst: 'Choose the declarant first.',
  loadingVersions: 'Loading versions…',
  versionsFailed: 'We could not load the declarations. Try again in a moment.',
  noVersions: 'The declarant has submitted no declaration at the Commission yet.',
  versionRequired: 'Choose the version the copy is of.',
  versionOption: (type: string, year: string, version: number) =>
    `${type}${year ? ` ${year}` : ''} · version ${String(version)}`,
  submittedOn: (date: string) => `submitted ${date}`,
  current: 'Current',
  superseded: 'Superseded',
  declarationTypes: {
    initial: 'Initial declaration',
    biennial: 'Biennial declaration',
    final: 'Final declaration',
  },

  deliveryTitle: 'Delivery',
  deliveryLabel: 'How the declarant gets the copy',
  collect: (commission: string) => `Collect at ${commission}`,
  collectFallback: 'Collect at the Commission',
  dispatch: 'Dispatch by post or courier',

  issueWithin: 'Issue within 14 days',
  issuesAtOnce: 'The certified copy is prepared as soon as you record the application.',
  cancel: 'Cancel',
  record: 'Record and issue copy',
  recorded: 'Application recorded. Preparing the certified copy.',
  fixErrors: (count: number) =>
    count === 1 ? 'Fix 1 problem to continue.' : `Fix ${String(count)} problems to continue.`,

  // Failures
  sessionEnded: 'Your session has ended. Sign in again.',
  saveFailed: 'We could not record the application. Try again.',
  supervisorCannotAct: 'Only the access officer records applications.',
  notOnboardedProblem: 'This roster record has no declarant account. Choose another.',
  versionProblem: 'That version is not one the declarant submitted here. Choose another.',
  proofProblem: 'Upload this file again: it is not one of your clean uploads.',
  unavailable: {
    'directory-unavailable': 'The roster cannot be reached. Try again in a moment.',
    'declarations-unavailable': 'Declarations cannot be reached. Try again in a moment.',
    'documents-unavailable': 'Documents cannot be reached. Try again in a moment.',
    'key-service-unavailable': 'The key service cannot be reached. Try again in a moment.',
    'workflow-unavailable': 'The copy cannot be ordered right now. Try again in a moment.',
  } as Record<string, string>,

  // Application
  notFoundTitle: 'Application not found',
  notFoundText: 'It may belong to another Commission, or the link is wrong.',
  backToCopies: 'Back to certified copies',
  applicationErrorTitle: 'We could not load the application',
  applicationErrorDetail: 'Check your connection and try again.',
  receivedLine: (file: string, date: string) => `File ${file} · received ${date}`,
  applicationTitle: 'Application',
  appliedBy: 'Applied by',
  representativeLine: (idNumber: string) => `Representative · ID ${idNumber}`,
  version: 'Version',
  versionValue: (version: number) => `Version ${String(version)}`,
  delivery: 'Delivery',
  deliveryCollection: (commission: string) => `Collect at ${commission}`,
  deliveryDispatch: 'Dispatch',
  identityCheck: 'Identity check',
  recordedLine: (who: string, date: string) => `${who} · ${date}`,
  representativeDocuments: 'Representative documents',
  scannedClean: 'Scanned clean',
  declarantSees:
    'The declarant sees the copy, naming who applied, under Who accessed my declaration.',
  copyTitle: 'Certified copy',
  copyName: (version: number) => `Certified copy · version ${String(version)}`,
  restricted: 'Restricted',
  preparing: 'Preparing the certified copy.',
  preparingSlow: 'This is taking longer than usual. The page updates when the copy is ready.',
  preparingStopped: 'This is taking longer than usual. Check again in a few minutes.',
  checkAgain: 'Check again',
  failedText: 'Could not issue the copy. Nothing was issued.',
  failedHint:
    'Record the application again to try once more. If it fails again, contact the platform administrator.',
  waitingIssue: 'Waiting for the certified copy to be issued.',
  downloadCopy: 'Download to print',
  downloading: 'Preparing download…',
  downloadFailed: 'We could not download the copy. Try again.',
  downloadNotYours: (officer: string) =>
    `Only ${officer}, who recorded the application, can download the copy to hand it over.`,
  verification: 'Verification',
  issuedAt: 'Issued',
  markCollected: 'Mark collected',
  markDispatched: 'Mark dispatched',
  collected: 'Collected',
  dispatched: 'Dispatched',
  markCollectedTitle: 'Mark the copy collected?',
  markDispatchedTitle: 'Mark the copy dispatched?',
  markCollectedBody: (who: string) =>
    `Confirm that ${who} collected the printed certified copy. This cannot be undone.`,
  markDispatchedBody: (who: string) =>
    `Confirm that the printed certified copy was sent to ${who}. This cannot be undone.`,
  markedCollected: 'Marked collected',
  markedDispatched: 'Marked dispatched',
  stale: 'This application changed. The page has been updated.',
  markFailed: 'We could not save this. Try again.',
  supervisorWaits: 'The access officer hands over the copy and marks it.',
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
