import { formatNumber } from '../format';

/**
 * Copy of the Roster workspace (spec 02 frontend). One English string per key; the Swahili slot
 * stays empty until translations are reviewed by EACC. Replace with the console-wide message
 * convention when it lands.
 */
export const en = {
  title: 'Roster',
  readOnly: 'Read only',
  loading: 'Loading…',
  // Overview
  noneTitle: 'No roster yet',
  noneText:
    "Import your Commission's declarant roster to start onboarding. Download the template, fill it from your HR extract, upload it here.",
  noneTextReadOnly: 'Your reporting officer has not imported it yet.',
  downloadTemplate: 'Download template',
  templateCsv: 'CSV template (.csv)',
  templateXlsx: 'Excel template (.xlsx)',
  templateError: 'The template could not be downloaded. Try again.',
  importRoster: 'Import roster',
  importNotYet: 'Roster import is not available yet.',
  summaryCards: 'Roster summary',
  expectedDeclarants: 'Expected declarants',
  onboarded: 'Onboarded',
  onboardedShare: (percent: number) => `${formatNumber(percent)}%`,
  toGo: (count: number) => `${formatNumber(count)} to go`,
  flagged: 'Flagged as absent',
  errorTitle: 'Roster could not be loaded',
  errorDetail: 'Check your connection and try again.',
  tryAgain: 'Retry',
  // No workspace
  forbidden: 'You do not have access to the roster.',
  backToOverview: 'Back to overview',
  nationalTitle: 'Rosters belong to each Commission',
  nationalText: "See coverage and import history on each Commission's page.",
  nationalAction: 'Commissions',
  // API access
  apiTitle: 'API access',
  apiCreatedTitle: 'Credentials created',
  apiRotatedTitle: 'New secret created',
  apiNoneTitle: 'No API credentials',
  apiNoneText:
    'Let your HR system update the roster directly. Create credentials and share them with your IT team.',
  apiCreate: 'Create credentials',
  apiCreating: 'Creating…',
  apiCardTitle: 'HR system credentials',
  apiActive: 'Active',
  apiRevokedOn: (date: string) => `Revoked ${date}`,
  apiClientId: 'Client ID',
  apiClientSecret: 'Client secret',
  apiTokenEndpoint: 'Token endpoint',
  apiScope: 'Scope',
  apiCreated: 'Created',
  apiCreatedOn: (date: string, name: string | null) => (name ? `${date}, by ${name}` : date),
  apiLastRotated: 'Last rotated',
  apiLastUsed: 'Last used',
  apiRevoked: 'Revoked',
  apiNever: 'Never',
  apiRevokedText: 'Your HR system can no longer update the roster.',
  apiBatchesText:
    'Your HR system sends batches of up to 1,000 rows. Each batch appears in the import history.',
  apiNotUsedYet: 'Not used yet.',
  apiCopy: 'Copy',
  apiCopyLabel: (field: string) => `Copy ${field.charAt(0).toLowerCase()}${field.slice(1)}`,
  apiCopied: (field: string) => `${field} copied`,
  apiShow: 'Show',
  apiHide: 'Hide',
  apiShowSecret: 'Show client secret',
  apiHideSecret: 'Hide client secret',
  apiSecretHidden: 'Hidden',
  apiSecretWarning: 'Copy the secret now. It will not be shown again.',
  apiSecretShare: 'Share it with your IT team securely.',
  apiDone: 'Done',
  apiRotate: 'Rotate secret',
  apiRotating: 'Rotating…',
  apiRotateTitle: 'Rotate secret?',
  apiRotateText:
    'The current secret stops working immediately. Your HR system must be updated with the new secret.',
  apiRevoke: 'Revoke access',
  apiRevoking: 'Revoking…',
  apiRevokeTitle: 'Revoke API access?',
  apiRevokeText: 'Your HR system will no longer be able to update the roster.',
  apiRevokeHistory: 'Past imports stay in the history.',
  apiSavedTitle: 'Have you saved the secret?',
  apiSavedText:
    'You will not be able to see it again. If it is lost, rotate the secret to get a new one.',
  apiSavedBack: 'Go back',
  apiSavedConfirm: 'Yes, I saved it',
  apiCancel: 'Cancel',
  apiActiveToast: 'Credentials are active',
  apiRotatedToast: 'Secret rotated. The old secret no longer works',
  apiRevokedToast: 'API access revoked',
  apiCreateError: 'Credentials were not created. Try again.',
  apiRotateError: 'The secret was not rotated. Try again.',
  apiRevokeError: 'Access was not revoked. Try again.',
  apiForbidden: 'Only the reporting officer can change API credentials.',
  apiAlreadyExists: 'Your Commission already has API credentials.',
  apiAlreadyRevoked: 'These credentials were already revoked.',
  apiClientMissing:
    'These credentials no longer exist in the sign-in service. Revoke them and create new ones.',
  apiNoAccess: 'Only the reporting officer can manage API credentials.',
  apiErrorTitle: 'API access could not be loaded',
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
