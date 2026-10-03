import { formatDate } from '@adili/ui';

/** Copy of the determinations tab of the approvals inbox (spec 08 FE-3, S1, S2). */
export const messages = {
  tab: 'Determinations',
  openCase: 'Open case',
  approve: 'Approve',
  return: 'Return',
  approveDialog: {
    title: 'Approve determination',
    proposedBy: (name: string, date: string) => `Proposed by ${name} on ${formatDate(date)}`,
    reasons: 'Reasons',
    consequences: 'When you approve',
    cmp: 'A CMP number is allocated in your name',
    cmpDetail: 'The next number in sequence, printed on the decision letter',
    letter: 'The decision letter is issued',
    letterDetail: 'Restricted, with a QR code the declarant can verify',
    notified: (name: string) => `${name} is notified`,
    notifiedDetail: 'By email, SMS and in the portal',
    closed: 'The case is closed as determined',
    furtherOpen: 'The case stays open for the further action',
    cancel: 'Cancel',
    confirm: 'Approve determination',
  },
  returnDialog: {
    title: 'Return to the reviewer',
    subject: (reference: string, name: string) => `${reference} · proposed by ${name}`,
    reason: 'Reason',
    placeholder: 'Say what needs to change.',
    hint: (name: string) => `Shown to ${name} on the case.`,
    required: 'Enter a reason.',
    tooLong: 'The reason can be up to 2,000 characters.',
    cancel: 'Cancel',
    confirm: 'Return proposal',
  },
  /** 403 from approve or return, after the inbox said the viewer could. */
  refused: {
    title: 'You cannot approve this',
    'reviewer-of-record': 'You cannot approve this: you reviewed this case.',
    proposer: 'You proposed this.',
    role: 'Only a supervisor can approve this.',
    separationAfter:
      'You proposed it or held the case after this page loaded, so another supervisor must approve it.',
    roleAfter: 'Your account is not a supervisor of this Commission any more.',
  },
  decided: {
    title: 'Already decided',
    body: 'Someone decided this determination while the page was open.',
    after: 'The list has been refreshed. Nothing was changed by you.',
  },
  toasts: {
    approved: (reference: string | null) =>
      reference ? `Approved. ${reference} allocated.` : 'Approved',
    returned: 'Returned to the reviewer',
  },
} as const;
