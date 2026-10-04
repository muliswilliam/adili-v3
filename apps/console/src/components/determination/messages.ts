import { formatDate } from '@adili/ui';

import type { DeterminationRefusal } from '../../determination/refusals';

/** Copy of the case's Determination page and its dialogs (spec 08 FE-2). */
export const messages = {
  crumb: 'Determination',
  aSupervisor: 'A supervisor',
  unassigned: 'Unassigned',
  received: (date: string) => `Received ${formatDate(date)}`,
  audit: 'Every view of this case is recorded.',
  fullCase: 'Full case',
  propose: 'Propose determination',
  card: {
    title: 'Determination',
    notProposed: 'Not proposed',
    emptyTitle: 'No determination yet',
    emptyBody: 'The assigned reviewer proposes one.',
    emptyBodyAssignee: 'Propose one when the review is finished.',
    outcome: 'Determination',
    reference: 'Reference',
    referencePending: 'Allocated on approval',
    proposed: 'Proposed',
    approver: 'Approver',
    notApproved: 'Not yet approved',
    reasons: 'Reasons',
    furtherAction: 'Further action',
    history: 'History',
    status: {
      proposed: 'Awaiting approval',
      approved: 'Approved',
      returned: 'Returned',
      withdrawn: 'Withdrawn',
    },
  },
  banner: {
    heldBy: (name: string) => `Only ${name}, the assigned reviewer, can propose`,
    heldByNext: 'A supervisor can reassign it from the review queue.',
    unassigned: 'Nobody holds this case yet',
    unassignedNext: 'Claim it from the full case to propose a determination.',
    clarificationOpen: 'A clarification is still open',
    clarificationOpenNext: 'Resolve or withdraw it before you propose a determination.',
    proposed: (name: string, date: string) =>
      `Determination proposed by ${name} on ${formatDate(date)}, awaiting approval`,
    withdraw: 'Withdraw',
    openInApprovals: 'Open in Approvals',
    returned: (name: string, date: string) => `Returned by ${name} on ${formatDate(date)}`,
    revise: 'Revise',
    onlyHolderRevises: (name: string) => `Only ${name}, the assigned reviewer, can revise it.`,
    determined: (outcome: string) => `Determined: ${outcome}`,
    approvedBy: (name: string, date: string) =>
      `Approved by ${name} on ${formatDate(date)}. Letter issued and declarant notified.`,
    furtherApproved: (name: string, date: string) =>
      `Further action approved by ${name} on ${formatDate(date)}`,
    furtherNext: 'The case stays open until the referral or action is complete.',
    letter: 'Decision letter',
    letterPreparing: 'Preparing…',
  },
  side: {
    reviewers: 'Reviewers of record',
    reviewersTip: 'Everyone who has held this case. None of them can approve its determination.',
    noReviewers: 'Nobody has held this case yet.',
    flags: 'Flags',
    flagsReviewed: (reviewed: number, total: number) =>
      `${String(reviewed)} of ${String(total)} reviewed`,
    noFlags: 'No flags were raised.',
    flagsFoot: 'Flags are indicators, not findings.',
    clarifications: 'Clarifications',
    noClarifications: 'No clarification was requested.',
  },
  dialog: {
    title: 'Propose determination',
    reviseTitle: 'Revise determination',
    outcome: 'Determination',
    reasons: 'Reasons',
    reasonsPlaceholder: 'Say what you found and why. Refer to flags, clarifications and responses.',
    note: 'Further action',
    notePlaceholder: 'For example: refer to EACC for the undeclared parcel.',
    noteHint: 'Start the referral or action from the case once this is approved.',
    consequence: 'On approval the decision letter is issued and the declarant is notified.',
    cancel: 'Cancel',
    submit: 'Propose for approval',
    returnedReason: (name: string) => `${name} returned it:`,
  },
  withdrawDialog: {
    title: 'Withdraw this proposal?',
    body: 'It leaves the approvals inbox. You can propose again afterwards.',
    cancel: 'Keep it',
    confirm: 'Withdraw proposal',
  },
  toasts: {
    proposed: 'Proposed for approval',
    withdrawn: 'Proposal withdrawn',
    sessionEnded: 'Your session has ended. Sign in again.',
    failed: 'That did not work. Try again in a moment.',
    letterFailed: 'Could not get the decision letter. Try again in a moment.',
  },
  refusals: {
    'determination-open': {
      title: 'A determination is already proposed for this case',
      detail:
        'Someone proposed or approved a determination while you were writing. Your text is kept below. Close this dialog to see the current determination.',
    },
    'clarification-open': {
      title: 'A clarification of this case is still open',
      detail: 'Resolve or withdraw it first. Your text is kept below.',
    },
    'not-the-assignee': {
      title: 'Only the assigned reviewer can propose',
      detail: 'The case was reassigned while this page was open.',
    },
    'not-the-proposer': {
      title: 'Only the reviewer who proposed it can withdraw it',
    },
    'not-proposed': {
      title: 'This proposal was decided already',
      detail: 'The page has been refreshed.',
    },
    'separation-of-duties': {
      title: 'You cannot decide this',
      detail: 'You proposed it or held the case, so another supervisor must decide it.',
    },
    'supervisor-required': {
      title: 'Only a supervisor can decide this',
    },
  } satisfies Record<DeterminationRefusal['kind'], { title: string; detail?: string }>,
  notFound: {
    title: 'Case not found',
    body: 'The link may be wrong, or the case belongs to another Commission.',
    back: 'Back to overview',
  },
  loadFailed: {
    title: 'We could not load this case',
    body: 'The review service did not answer. Try again in a moment.',
    retry: 'Try again',
  },
} as const;
