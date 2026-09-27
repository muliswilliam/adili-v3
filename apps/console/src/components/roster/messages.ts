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
  summaryCards: 'Roster summary',
  expectedDeclarants: 'Expected declarants',
  onboarded: 'Onboarded',
  onboardedShare: (percent: number) => `${formatNumber(percent)}%`,
  toGo: (count: number) => `${formatNumber(count)} to go`,
  flagged: 'Flagged as absent',
  errorTitle: 'Roster could not be loaded',
  errorDetail: 'Check your connection and try again.',
  tryAgain: 'Retry',
  // Import wizard
  importTitle: 'Import roster',
  cancel: 'Cancel',
  back: 'Back',
  importSteps: 'Import steps',
  stepTemplate: 'Template',
  stepUpload: 'Upload',
  stepCheck: 'Check',
  stepImport: 'Import',
  stepReport: 'Report',
  importReadOnly: 'Only the reporting officer can import the roster.',
  backToRoster: 'Back to roster',
  // Step 1: template
  templateTitle: 'Get the template',
  templateIntroBefore: 'Fill the template from your HR extract. Nine columns;',
  templateIntroAnd: 'and',
  templateIntroAfter: 'are required.',
  downloadCsvTemplate: 'Download CSV template',
  downloadXlsxTemplate: 'Download XLSX template',
  templateTip: 'Prefer Excel: it keeps leading zeros.',
  columnsCaption: 'Template columns',
  columnName: 'Column',
  columnRequired: 'Required',
  columnFormat: 'Format',
  columnExample: 'Example',
  required: 'Required',
  optional: 'Optional',
  haveFile: 'I have a file',
  // Step 2: upload
  uploadTitle: 'Upload your file',
  dropLabel: 'Drop your roster file here or browse.',
  dropHint: 'CSV (UTF-8) or Excel. Up to 50 MB and 1,000,000 rows.',
  tooLarge: (size: string) => `This file is ${size}. The limit is 50 MB.`,
  wrongType: 'Use a .csv or .xlsx file.',
  preparing: 'Preparing upload…',
  uploading: 'Uploading…',
  uploadProgress: 'Upload progress',
  cancelUpload: 'Cancel',
  cancelUploadLabel: (fileName: string) => `Cancel uploading ${fileName}`,
  scanning: 'Checking the file…',
  passedScan: 'Passed scan',
  failedScan: 'Failed scan',
  notUploaded: 'Not uploaded',
  infectedTitle: 'This file failed the security scan and was not imported.',
  infectedText: 'Scan the source computer and export the file again.',
  rejectedType: 'This is not a CSV or Excel file.',
  rejectedSize: 'The file is over 50 MB.',
  uploadFailed: 'The upload did not complete. Try again.',
  retryUpload: 'Try again',
  chooseAnother: 'Choose another file',
  // Step 3: check (the column check arrives with #40)
  checkTitle: 'Check the columns',
  checkNotYet: 'Checking the columns and starting the import are not available yet.',
  // Leaving with an upload
  discardTitle: 'Discard this upload?',
  discardText:
    'The file you uploaded will not be imported. Nothing on the roster has changed. You can upload it again later.',
  keepWorking: 'Keep working',
  discardUpload: 'Discard upload',
  uploadDiscarded: 'Upload discarded',
  // No workspace
  forbidden: 'You do not have access to the roster.',
  backToOverview: 'Back to overview',
  nationalTitle: 'Rosters belong to each Commission',
  nationalText: "See coverage and import history on each Commission's page.",
  nationalAction: 'Commissions',
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
