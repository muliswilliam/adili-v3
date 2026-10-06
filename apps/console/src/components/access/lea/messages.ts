/**
 * Copy of law enforcement requests in the Access requests workspace (spec 10 FE-6), from the
 * console prototype (`apps/console/prototype/10-access.prototype.html`): the access officer's
 * request page, verification and decision. English, with an empty Swahili slot (`sw`), as
 * `access/messages.ts`.
 */
export const en = {
  lawEnforcement: 'Law enforcement',
  title: 'Law enforcement request',
  receivedLine: (agency: string, date: string) => `${agency} · received ${date}`,
  decisionDue: 'Decision due',
  decisionDueOn: (date: string) => `Decision due ${date}`,
  breached: 'Deadline breached',
  notFoundTitle: 'Request not found',
  notFoundText: 'The link may be wrong, or the request belongs to another Commission.',
  backToRequests: 'Back to access requests',
  requestErrorTitle: 'We could not load this request',
  requestErrorDetail: 'The access service did not answer. Try again in a moment.',
  tryAgain: 'Try again',

  // Who is told
  neverTold: 'The declarant is not told of law enforcement requests.',
  notifiedAfterGrantInWriting: 'Declarant notified in writing after grant',
  notToldDenied: (agency: string) => `The declarant is not told. ${agency} received the reasons.`,
  notToldWithdrawn: 'The declarant is not told. The request was withdrawn before a decision.',

  // Withdrawn
  closedTitle: 'Closed',
  withdrawnOutcome: 'Withdrawn by the agency',
  withdrawnBy: (officer: string, agency: string, at: string) =>
    `${officer} (${agency}) withdrew it on ${at}, before a decision. Nothing more is needed.`,

  // Written request
  writtenRequest: 'Written request',
  noFormK: 'No Form K',
  noFormKTip:
    'Regulation 23(1): a law enforcement agency writes to the Commission with its reason and does not fill Form K.',
  noFormKTipLabel: 'About No Form K',
  requestedBy: 'Requested by',
  agency: 'Agency',
  requestingOfficer: 'Requesting officer',
  caseReference: 'Case reference',
  officerSought: 'Officer sought',
  name: 'Name',
  entity: 'Entity',
  workStation: 'Work station',
  personnelFileNumber: 'Personnel file number',
  notGiven: 'Not given',
  reasonForAccess: 'Reason for access',
  scopeRequested: 'Scope requested',
  years: 'Years',
  people: 'People',
  sections: 'Sections',
  registerTitle: 'Register',
  registerLabel: 'Access register',
  whereItStands: 'Where the request stands',
  /** The declarant never hears of a law enforcement request (#614). */
  receivedSummary: (caseReference: string) => `Case ${caseReference}. The declarant is not told.`,
  requestVerified: 'Request verified',
  officerIdentifiedSummary: (name: string) => `Officer identified: ${name}.`,
  notifiedAfterGrant: 'Declarant notified after grant',
  agencyToldSummary: (agency: string) => `${agency} told with reasons.`,

  // Verify
  verifyTitle: 'Verify',
  provenanceFact: (agency: string, officer: string) =>
    `Sent from a provisioned ${agency} account: ${officer}`,
  activatedOn: (date: string) => `, activated ${date}`,
  mandateFact: (basis: string) => `Agency mandate: ${basis}`,
  provenanceConfirmed: 'Agency and officer confirmed',
  reasonConfirmed: 'Reason for access stated',
  provenanceRequired: 'Confirm the request comes from the agency account it shows.',
  reasonRequired: 'Confirm the request states its reason.',
  onTheRoster: 'Officer on the roster',
  notOnboardedHint: 'No account yet: you tell them in writing after a grant.',
  recordRequired: 'Choose the roster record of the officer sought.',
  note: 'Note',
  notePlaceholder: 'What you checked',
  noteHint: 'Recorded with the verification.',
  noteRequired: 'Say what you checked.',
  noteTooLong: 'Keep the note to 1,000 characters.',
  recordVerification: 'Record verification',
  verified: 'Request verified. Decide next.',
  cannotVerify: 'Cannot verify it?',
  denyInstead: 'Deny the request',
  waitingVerify: 'Waiting for the access officer to verify.',

  // Verification record
  verificationTitle: 'Verification',
  verifiedLabel: 'Verified by',
  officerIdentified: 'Officer identified',

  // Decision side card
  decisionTitle: 'Decision',
  decide: 'Decide',
  decisionReadOnly: 'Only the access officer decides.',
  decisionFinal: 'Final',

  // Decide page
  decideTitle: 'Decide',
  decideCrumb: 'Decide',
  requestTitle: 'Request',
  agencyLine: (officer: string, caseReference: string) => `${officer} · case ${caseReference}`,
  reason: 'Reason',
  officer: 'Officer',
  notIdentified: 'Not identified',
  readOnlyTitle: 'Only the access officer decides',
  readOnlyText: 'Supervisors can read requests and decisions.',
  decidedTitle: 'Already decided',
  decidedText: (name: string | null, date: string) =>
    `Decided${name ? ` by ${name}` : ''} on ${date}. Decisions are final.`,
  backToRequest: 'Back to request',
  cancel: 'Cancel',
  verifyFirst:
    'The request is not verified, so it can only be denied now: for an officer you cannot identify, or an account that is no longer active. Verify it first to grant it.',
  decidedRecorded: (agency: string) => `Decision recorded. ${agency} is being told.`,
  final: 'This decision is final.',
  notVerifiedTitle: 'Not verified yet',
  notVerified:
    'The request is not verified, so it can only be denied. Open the request to verify it first.',
  finalityGrant: "The agency's officer gets the package. The declarant is not notified.",
  finalityDeny: (agency: string) =>
    `${agency} is told with your reasons. The declarant is not notified.`,
  reasonsHint: 'Sent to the agency.',
};

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
