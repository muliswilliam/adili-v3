/** The Form M sign-off's copy (spec 09 FE comment and the #226 prototype screens). */
export const en = {
  youFillThis: 'You fill this',
  contactPlaceholder: 'e.g. +254 20 222 3901',
  emailPlaceholder: 'e.g. compliance@publicservice.go.ke',
  invalidEmail: 'Enter a valid email address',
  partISaving: {
    idle: 'Autosaves',
    saving: 'Saving…',
    saved: 'Saved',
    retrying: 'Could not save, retrying',
    error: 'Could not save Part I',
    conflict: 'Edited elsewhere: reload to continue',
  },
  partBSaving: {
    idle: 'Saves as you go',
    saving: 'Saving…',
    saved: 'Saved',
    retrying: 'Could not save, retrying',
    error: 'Could not save Part B',
    conflict: 'Edited elsewhere: reload to continue',
  },
  addComplaint: 'Add complaint',
  editComplaint: 'Edit complaint',
  editComplaintFor: (n: number) => `Edit complaint ${String(n)}`,
  removeComplaint: (n: number) => `Remove complaint ${String(n)}`,
  rowActions: 'Row actions',
  edit: 'Edit',
  complaintDialog: { add: 'Add a complaint', edit: 'Edit complaint' },
  saveChanges: 'Save changes',
  complaintFields: {
    name: 'Name',
    designation: 'Designation',
    identifier: 'Staff, file, ID or passport number',
    nature: 'Nature of complaint',
    natureHint: 'In general terms only.',
    naturePlaceholder: 'e.g. Alleged undisclosed business interest',
    status: 'Status',
    statusPlaceholder: 'e.g. Under investigation',
  },
  required: (field: string) => `Enter the ${field.toLowerCase()}`,
  cancel: 'Cancel',
  markReviewed: 'Mark reviewed',
  reviewedTitle: 'Mark Form M reviewed',
  reviewedText:
    'You confirm you have checked the numbers, lists and remarks. Your name and designation go into Part III as "Compiled by".',
  name: 'Name',
  date: 'Date',
  designation: 'Designation',
  designationPlaceholder: 'e.g. Deputy Director, HRM',
  designationRequired: 'Enter your designation',
  reviewedFailed: 'The draft was not marked reviewed. Try again.',
  reviewedRefused: 'The draft changed meanwhile. Close this and look again.',
  confirmAndSubmit: 'Confirm and submit',
  awaitingReview: 'Awaiting supervisor review',
  awaitingConfirmation: 'Awaiting confirmation by the commission administrator',
  stillToFill: (partI: string[], partB: boolean) =>
    [
      partI.length > 0 ? `Fill Part I: ${partI.join(', ')}` : null,
      partB ? 'Answer question 6 in Part B' : null,
    ]
      .filter(Boolean)
      .join(' · '),
  saving: 'Saving your changes…',
  confirmTitle: 'Confirm and submit Form M',
  confirmText: (fy: string) =>
    `Confirm and submit Form M for ${fy} to EACC? The report is frozen and receives its reference.`,
  consequences: {
    frozen: 'Nobody can change it after this, including you.',
    reference: 'It gets a reference number and a signed acknowledgement receipt.',
    confirmedBy: (name: string, date: string) =>
      `Part III records you, ${name}, as the officer who confirmed it, dated ${date}.`,
    notified: (reviewer: string | null) =>
      `You and ${reviewer ?? 'the supervisor'} are notified with the receipt.`,
  },
  lateWarning: (due: string) => `Due ${due}. It will be recorded as late.`,
  confirmFailed: 'Form M was not submitted. Try again. Nothing was sent twice.',
  confirmCheckbox: 'I confirm the information is correct',
  tryAgain: 'Try again',
  submitting: 'Submitting…',
  stepUpFailedTitle: 'We could not confirm your identity. Try again.',
  stepUpFailedText: 'Form M has not been submitted.',
  confirmIdentity: 'Confirm identity',
  refused: {
    'already-submitted': {
      title: 'This report was already submitted.',
      text: 'Someone else confirmed it first.',
    },
    'not-reviewed': {
      title: 'Form M was not submitted.',
      text: 'The draft was recompiled since it was reviewed. Your supervisor must review it again.',
    },
    compiling: {
      title: 'Form M was not submitted.',
      text: 'The draft is being recompiled. Try again once it is ready.',
    },
    forbidden: {
      title: 'Form M was not submitted.',
      text: 'Only the commission administrator of your Commission can confirm Form M.',
    },
    incomplete: { title: 'Form M is not complete.' },
  },
  incompleteText: (partI: string[], partB: boolean) =>
    [
      partI.length > 0 ? `Fill ${listed(partI)} in Part I.` : null,
      partB ? 'Answer question 6 in Part B.' : null,
    ]
      .filter(Boolean)
      .join(' ') || 'Complete the report before you confirm it.',
  goToPartI: 'Go to Part I',
  goToPartB: 'Go to Part B',
  partIFields: {
    contactDetails: 'contact details',
    physicalAddress: 'physical address',
    emailAddress: 'email address',
  },
  submittedTitle: 'Submitted to EACC',
  confirmedBy: (name: string, when: string) => `Confirmed by ${name}, ${when}`,
  byOwnSystem: (when: string) => `By your Commission's system, ${when}`,
  submittedAt: (when: string) => `Submitted ${when}`,
  lateBadge: (due: string) => `Late: due ${due}`,
  onTime: 'On time',
  hosted: 'Hosted on Adili',
  federated: 'Submitted via API',
  downloadFormM: 'Download Form M (PDF)',
  downloadReceipt: 'Download receipt',
  preparingFormM: 'Preparing Form M PDF…',
  preparingReceipt: 'Preparing receipt…',
  preparingSlow: 'This is taking longer than usual.',
  checkAgain: 'Check again',
  downloadFailed: 'We could not download the file. Try again.',
  noCorrections: 'Corrections are not possible yet. Contact EACC with the reference number.',
  reportAsSubmitted: 'Report as submitted',
};

/** "a, b and c". */
function listed(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
