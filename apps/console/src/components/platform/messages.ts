import { plural } from '@adili/ui';

import type { LeaOfficerState } from '../../server/directory/client';

/**
 * Copy of Platform settings, law-enforcement accounts (spec 10 FE-6), from the console prototype
 * (`apps/console/prototype/10-access.prototype.html`, persona platform-admin). English only, as
 * the other console areas.
 */
export const en = {
  title: 'Law-enforcement accounts',
  workspaceTitle: 'Platform settings',
  tryAgain: 'Try again',
  backToOverview: 'Back to overview',
  forbidden: 'You do not have access to platform settings.',
  accessErrorTitle: 'We could not load your access',
  accessErrorDetail: 'Check your connection and try again.',

  // Agencies
  agenciesCaption: 'Law enforcement agencies',
  columnAgency: 'Agency',
  columnBasis: 'Legal basis',
  columnActive: 'Active',
  columnInvited: 'Invited',
  columnRevoked: 'Revoked',
  countUnknown: 'Not known',
  agenciesErrorTitle: 'We could not load the agencies',
  agenciesErrorDetail: 'The directory did not answer. Try again in a moment.',
  agenciesNote:
    'Officers sign in to the console with two-factor authentication and file requests to any Commission.',
  noAgenciesTitle: 'No agencies',
  noAgenciesText: 'Agencies are reference data, added by a release.',

  // Officers
  provision: 'Provision officer',
  searchLabel: 'Search officers',
  searchPlaceholder: 'Name or email',
  filtersLabel: 'Show',
  officersLabel: 'officers',
  filters: {
    all: 'All',
    activated: 'Active',
    invited: 'Invited',
    revoked: 'Revoked',
  } satisfies Record<'all' | LeaOfficerState, string>,
  officersCaption: (code: string) => `${code} officers, by name`,
  columnOfficer: 'Officer',
  columnPhone: 'Phone',
  columnStatus: 'Status',
  columnInvitedOn: 'Invited',
  columnActivatedOn: 'Activated',
  columnActions: 'Actions',
  state: { activated: 'Active', invited: 'Invited', revoked: 'Revoked' } satisfies Record<
    LeaOfficerState,
    string
  >,
  revokedOn: (date: string) => `Revoked ${date}`,
  revoke: 'Revoke',
  revokeOfficer: (name: string) => `Revoke ${name}`,
  noOfficersTitle: 'No officers yet',
  noOfficersText: (code: string) => `Provision the first ${code} officer.`,
  noMatchesTitle: 'No matches',
  noMatchesText: 'No officers match these filters.',
  clearFilters: 'Clear filters',
  officersErrorTitle: 'We could not load the officers',
  officersErrorDetail: 'The directory did not answer. Try again in a moment.',
  notFoundTitle: 'Agency not found',
  notFoundText: 'The link may be wrong. Agencies are listed under law-enforcement accounts.',
  backToAgencies: 'Back to agencies',
  pagination: 'Officers pages',
  pageRange: (from: number, to: number) => `Showing ${String(from)}-${String(to)} officers`,
  pageRows: (count: number) => `Showing ${plural(count, 'officer')}`,
  previousPage: 'Previous page',
  nextPage: 'Next page',

  // Provision dialog
  provisionTitle: 'Provision officer',
  agency: 'Agency',
  fullName: 'Full name',
  namePlaceholder: 'Rank and name, e.g. Insp. Jane Mwangi',
  officialEmail: 'Official email',
  emailPlaceholder: 'name@agency.go.ke',
  emailHint: 'Becomes their console username.',
  phone: 'Phone',
  phonePlaceholder: '0712 345 678',
  phoneHint: 'Include the country code for non-Kenyan numbers.',
  phoneSavedAs: (phone: string) => `Saved as ${phone}`,
  nameError: "Enter the officer's full name.",
  emailError: 'Enter a valid official email address.',
  phoneError: 'Enter a valid phone number, e.g. 0712 345 678 or +254 712 345 678.',
  oneEmail: 'They get one activation email to set a password and an authenticator app.',
  cancel: 'Cancel',
  sendActivation: 'Send activation',
  sending: 'Sending…',
  provisioned: (name: string) => `${name} provisioned. The activation email is on its way.`,
  emailOtherTenant:
    "This email belongs to an account in another tenant. Use the officer's agency email.",
  emailOtherAgency: 'This email belongs to an officer of another agency.',
  rejected: 'Some details were not accepted',
  rejectedText: 'Check the highlighted fields.',
  failed: 'The officer was not provisioned. Try again.',
  failedText: 'Your details are kept. Retrying is safe.',
  notSent: 'The officer was provisioned, but the activation email was not sent',
  notSentText: 'Select Send activation again to send it. Your details are kept.',
  inProgress: 'The first attempt is still being processed',
  inProgressText: 'Wait a moment, then select Send activation again.',
  busy: 'Another change to this officer is still being processed',
  busyText: 'Wait a moment, then select Send activation again.',
  changed: 'These details changed after an earlier attempt',
  changedText: 'Select Send activation again to send them.',
  agencyGone: 'This agency no longer exists',
  forbiddenAction: 'Only platform administrators can manage officer accounts.',

  // Revoke dialog
  revokeTitle: (name: string) => `Revoke ${name}?`,
  cannotSignIn: 'They can no longer sign in',
  cannotSignInText: 'Effective immediately.',
  noDownloads: 'Granted packages can no longer be downloaded by them',
  stayOnRecord: 'Their requests stay on record',
  stayOnRecordText: 'The access register keeps every entry.',
  revokeAccess: 'Revoke access',
  revoking: 'Revoking…',
  revoked: (name: string) => `${name} revoked`,
  revokeFailed: 'The account was not revoked. Try again.',
  revokeBusy: 'Another change to this officer is still being processed. Try again shortly.',
};

export const messages = en;

/** The officer state badge tones, as the prototype's `OST`. */
export const STATE_TONE: Record<LeaOfficerState, 'success' | 'warning' | 'default'> = {
  activated: 'success',
  invited: 'warning',
  revoked: 'default',
};
