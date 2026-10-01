import { formatNumber } from '../format';

/**
 * Copy of the obligations policy: the policy card, its change dialog and the policy page (spec 04
 * frontend, FE-4). One English string per key; the Swahili slot stays empty until translations
 * are reviewed by EACC.
 */
export const en = {
  pageTitle: 'Obligations policy',
  crumb: 'Policy',
  openPolicy: 'Policy',
  cardTitle: 'Policy',
  inForceSince: (version: number, date: string) =>
    `Version ${formatNumber(version)} in force since ${date}`,
  statutoryPeriods: 'Statutory periods',
  initialPeriod: (days: number) => `Initial: ${formatNumber(days)} days after appointment`,
  biennialPeriod: (statement: string, due: string) =>
    `Biennial: statement ${statement}, due ${due}`,
  finalPeriod: (days: number) => `Final: ${formatNumber(days)} days after leaving office`,
  reminders: 'Reminders',
  remindersNone: 'No reminders',
  remindersBeforeDue: (list: string) => `${list} days before due`,
  startDate: 'Obligations start date',
  startDateTip:
    'Declarations of every type are owed on Adili only when their statement date is on or after this date.',
  startDateTipLabel: 'About the obligations start date',
  change: 'Change',
  history: 'Version history',
  historyEffective: (when: string) => `Effective ${when}`,
  inForce: 'In force',
  platformDefaults: 'Platform defaults',
  historyStartDate: (date: string) => `Obligations start date ${date}`,
  historyBy: (name: string) => `by ${name}`,
  // Dialog
  dialogTitle: 'Change obligations start date',
  currentStartDate: 'Current start date:',
  currentVersion: (version: number) => `(version ${formatNumber(version)})`,
  startDateHint:
    'Initial, biennial and final declarations are created only when their statement date (appointment, 1 November of the cycle, exit) is on or after this date. Earlier ones are assumed to have been declared outside Adili.',
  savesAs: (version: number) => `Saves as version ${formatNumber(version)}, effective now.`,
  cancel: 'Cancel',
  submit: 'Save as new policy version',
  submitting: 'Saving…',
  dateInvalid: 'Enter a valid date.',
  dateUnchanged: 'This is already the start date in force. Choose a different date.',
  savedToast: (version: number) => `Policy version ${formatNumber(version)} in force`,
  saveError: 'The policy was not changed. Try again.',
  saveErrorText: (version: number) => `Version ${formatNumber(version)} is still in force.`,
  saveRejected: 'The policy was not changed.',
  saveInProgress: 'The change is still being saved.',
  saveInProgressText: 'Wait a moment, then try again.',
  saveChanged: 'The policy changed while you were editing it.',
  saveChangedText: 'Close this dialog to see the version now in force, then try again.',
  saveForbidden: 'You cannot change this policy.',
  saveNotFound: 'This Commission is no longer on record.',
  // Page and card states
  loadErrorTitle: 'The policy could not be loaded',
  loadErrorDetail: 'The directory did not respond. Try again in a moment.',
  tryAgain: 'Try again',
  cardError: 'The policy could not be loaded. Reload the page to try again.',
  noAccess: 'You do not have access to Commission policies.',
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
