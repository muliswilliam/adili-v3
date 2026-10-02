import { formatDate, plural } from '@adili/ui';

/**
 * Copy of the clarification composer, its letter preview and the case's clarifications list
 * (spec 07a FE-4). English with empty Swahili slots, as elsewhere in the console.
 */
export const en = {
  newTitle: 'New clarification',
  draftTitle: 'Clarification draft',
  followUpTitle: 'Further clarification',
  to: (name: string, reference: string) => `To ${name} · re: ${reference}`,
  followUpOf: (reference: string) =>
    `Further clarification on ${reference}. Remove any items that were answered.`,
  viewLegend: 'Composer view',
  viewItems: 'Items',
  viewPreview: 'Letter preview',

  item: (n: number) => `Item ${String(n)}`,
  removeItem: 'Remove',
  removeItemLabel: (n: number) => `Remove item ${String(n)}`,
  discardItem: 'Discard',
  discardItemLabel: (n: number) => `Discard drafted item ${String(n)}`,
  aiDraft: 'AI draft',
  aiAssisted: 'AI-assisted',
  aiAssistedTip: 'Drafted with AI. Check it before issuing; you approve what is sent.',
  addItem: 'Add item',
  noItemsTitle: 'No items',
  noItemsText: 'Add at least one item.',

  targetLabel: 'What is this about?',
  targetPlaceholder: 'Search a section or item of the current version',
  targetFilter: 'Filter sections and items',
  targetList: 'Sections and items',
  targetNone: 'No matches',
  targetRequired: 'Choose what this item is about.',

  requirementLegend: 'What must the declarant do?',
  requirementRequired: 'Choose what the declarant must do.',

  textLabel: 'What you need',
  textPlaceholder: 'What is missing, inconsistent or wrong',
  textRequired: 'Write what you need from the declarant.',
  textTooLong: 'Keep this to 1,000 characters or fewer.',
  counter: (length: number, max: number) =>
    `${length.toLocaleString('en-KE')} / ${max.toLocaleString('en-KE')}`,

  openingLabel: 'Opening paragraph',
  discardOpeningLabel: 'Discard drafted opening paragraph',
  openingTooLong: 'Keep the opening paragraph to 800 characters or fewer.',
  otherLanguage: (language: string) =>
    `Drafted in ${language}, but the rest of the letter is in English. Rewrite it in English, or the letter will mix two languages.`,
  languages: { en: 'English', sw: 'Swahili' } as Record<string, string>,

  completeItems: 'Complete the highlighted items.',
  addOneItem: 'Add at least one item.',
  issueFailedTitle: 'This clarification could not be issued.',
  windowClosed: (date: string) =>
    `The clarification window closed on ${formatDate(date)}. Your draft is kept.`,
  notMine: 'Only the reviewer holding the case can issue its clarifications. Your draft is kept.',
  issueUnavailable: 'The review service did not answer. Your draft is kept; try again.',
  saveFailed: 'The draft could not be saved. Try again.',
  aiDraftGone:
    'An AI-drafted item or opening no longer matches a Draft with AI of this case. Discard it and draft again, or write it yourself.',
  saveStale: 'Only the reviewer holding the case can change its clarifications.',
  sessionEnded: 'Your session has ended. Sign in again.',

  responseDue: (date: string) => `Response due ${formatDate(date)}`,
  saveDraft: 'Save draft',
  saving: 'Saving…',
  issue: 'Issue clarification',
  issuing: 'Issuing…',
  savedToast: 'Draft saved. The declarant cannot see it.',
  issuedToast: (reference: string) => `${reference} issued`,

  confirmTitle: 'Issue this clarification?',
  confirmText:
    'This sends a numbered letter to the declarant and starts their 30-day period. Continue?',
  confirmItems: 'Items',
  confirmDue: 'Response due',
  confirmNote: 'Sent by email and SMS. You cannot edit it after issue, only withdraw it.',
  backToEditing: 'Back to editing',

  letter: {
    restricted: 'Restricted',
    ref: 'Ref',
    date: 'Date',
    re: 'Re',
    fileNumber: (number: string) => `File no. ${number}`,
    refPending: (code: string, year: number) =>
      `Allocated when issued (CLR-${code}-${String(year)}-…)`,
    heading: 'Request for clarification under section 35(2) of the Conflict of Interest Act, 2025',
    intro: (type: string) =>
      `The Commission has analysed your ${type} declaration and asks you to clarify the following, as allowed by section 35(4):`,
    noTarget: 'Item not chosen yet',
    noRequirement: 'Requirement not chosen yet',
    empty: 'Add an item to see it here.',
    respond: (due: string) =>
      `Please respond by ${formatDate(due)}, within thirty days as required by section 35(3). Respond online in the Adili portal under Clarifications, answering each point and attaching any documents. You can still respond after this date, but your response will be recorded as late.`,
    signOff: 'For the Commission Secretary',
    aiAssisted:
      'Parts of this letter were drafted with AI assistance, then checked and approved by the Commission reviewer who issued it.',
    verifyPending: 'The verification code and QR are added when the letter is issued.',
    verificationCode: 'Verification code',
    verifyHow: 'Scan the code, or enter it on the Adili verification page, to check this letter.',
    qrLabel: (code: string) => `QR code for verification code ${code}`,
    revoked: 'Withdrawn, issued in error',
    types: { initial: 'initial', biennial: 'biennial', final: 'final' },
  },

  list: {
    windowOpen: (date: string) => `Window open until ${formatDate(date)}`,
    windowClosed: (date: string) => `The clarification window closed on ${formatDate(date)}.`,
    heldBy: (name: string) => `Only ${name}, who holds this case, can issue clarifications.`,
    claimFirst: 'Claim this case to issue a clarification.',
    newClarification: 'New clarification',
    emptyTitle: 'No clarifications yet',
    emptyText: 'None issued for this case.',
    draftReference: 'Draft (no reference yet)',
    late: 'Late',
    listLabel: 'Clarifications on this case',
    draftLine: (items: number) => `Not sent · ${plural(items, 'item')}`,
    issued: (date: string) => `Issued ${formatDate(date)}`,
    withdrawn: 'withdrawn',
    responded: (date: string) => `responded ${formatDate(date)}`,
    respondedLate: (date: string, days: number) =>
      `responded ${formatDate(date)} (${plural(days, 'day')} late)`,
    due: (date: string) => `due ${formatDate(date)}`,
    resolved: (date: string) => `resolved ${formatDate(date)}`,
  },
};

export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
