import type { components } from './server/verification/schema.gen';

type RevokedReason = NonNullable<components['schemas']['VerificationResult']['revokedReason']>;

/**
 * Every string the verify app shows (spec 06 FE-5 and the #145 prototype). English only for
 * now; `verifyMessagesSw` is the Swahili slot, empty until the translations land.
 */
export const verifyMessages = {
  title: 'Verify a document | Adili Online',
  description: 'Check that a document issued by Adili Online is genuine and still valid.',

  homeHeading: 'Check an Adili Online document',
  homeIntro:
    'Scan the QR code on the document or type the verification code printed under it. Nothing you enter is stored with your identity.',
  codeLabel: 'Verification code',
  codePlaceholder: '7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P',
  codeHint: 'Starts with ADL. Not case sensitive.',
  codeEmpty: 'Enter the verification code printed under the QR code.',
  codeInvalid: 'Enter the code exactly as printed under the QR code, starting with ADL.',
  check: 'Check',
  checking: 'Checking',
  whereHeading: 'Where to find the code',
  whereVerifyAt: (host: string) => `Verify at ${host}`,
  // No-break spaces keep the date and the page number whole when the line wraps.
  whereSample:
    'Teachers Service Commission · Issued\u00A026\u00A0Sep\u00A02026 · Page\u00A01\u00A0of\u00A02',
  whereAlt:
    'The footer of an Adili Online document: a QR code with the verification code under it.',
  showsHeading: 'What the check shows',
  showsGenuine: 'Whether it is genuine and in force',
  showsDetails: 'Reference, type, Commission and issue date',
  showsNever: 'Never names, amounts or contents',
  showsMore: 'What is shown and recorded',

  resultTitle: (outcome: string) => `${outcome} | Verify a document | Adili Online`,
  checkAnother: 'Check another',
  codeCaption: 'Verification code',
  loading: 'Checking the document',

  valid: 'Valid document issued through Adili Online',
  validDetail: 'This document is genuine and in force.',
  validConfidentialDetail: 'Only validity is shown for this kind of document.',
  superseded: 'Superseded: a newer version of this document exists',
  supersededDetail: 'This copy was genuine when issued, but it has been replaced.',
  viewCurrent: 'View the current version',
  askForCurrent: 'Ask for the current version.',
  revoked: 'Revoked',
  revokedDetail: (reason: RevokedReason | null) =>
    reason === 'issued-in-error' || reason === 'withdrawn'
      ? `Reason: ${revokedReasons[reason]}. Do not rely on this document.`
      : 'Do not rely on this document.',
  expired: 'Expired',
  expiredDetail: 'It was genuine, but it is no longer valid.',
  notFound: 'Not found: no document with this code was issued through Adili Online.',
  notFoundDetail: 'Treat the document as not genuine.',
  notFoundHint: 'First check each character. 0 and O, or 1 and I, are common slips.',
  editCode: 'Edit code',
  malformed: 'This is not a valid verification code',
  malformedDetail: 'Codes start with ADL and never use the letters I, L, O or U.',
  tryAgain: 'Try again',
  rateLimited: 'Too many checks from your connection',
  rateLimitedDetail: (seconds: number) =>
    seconds > 0
      ? `Try again in ${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}.`
      : 'You can try again now.',
  rateLimitedNote: 'This says nothing about the document.',
  unavailable: 'We cannot check documents right now',
  unavailableDetail: 'This does not mean the document is fake. Try again in a few minutes.',

  documentType: 'Document type',
  issuedBy: 'Issued by',
  reference: 'Reference number',
  version: 'Version',
  issuedOn: 'Issued on',
  compare: 'Compare these with the printed document.',

  checkFileHeading: 'Check your file',
  identicalDetail: (version: number | null) =>
    version === null
      ? 'Not a single byte has changed.'
      : `Not a single byte has changed (version ${String(version)}).`,

  neverShown: 'Names, amounts and contents are never shown.',
  why: 'Why',

  footerRecorded:
    'Each check is recorded (time, result and network area, never the full IP address) to protect against abuse.',
  footerAbout: 'What this page shows',

  aboutTitle: 'What this page shows | Adili Online',
  back: 'Back',
  aboutHeading: 'What this page shows and records',
  aboutIntro: 'A check proves a document is genuine without revealing what it says.',
  aboutSee: 'What you see',
  aboutKind: 'Kind',
  aboutExamples: 'Examples',
  aboutShows: 'This page shows',
  aboutRestricted: 'Restricted',
  aboutRestrictedExamples: 'Acknowledgement slips, clarification letters, notices, Form M reports',
  aboutRestrictedShows:
    'Status, document type, issuing Commission, reference number, version and issue date',
  aboutConfidential: 'Confidential',
  aboutConfidentialExamples: 'Law enforcement packages, access packages, referrals',
  aboutConfidentialShows: 'Status only: "Valid document issued through Adili Online"',
  aboutPublic: 'Public',
  aboutPublicExamples: 'Compliance certificates, public reports',
  aboutPublicShows: "Status and the document's public content",
  aboutNever: 'Never shown',
  aboutNeverDetail:
    'Names, ID numbers, amounts, assets, findings, or anything written inside the document.',
  aboutRecord: 'What we record',
  aboutRecordChecks:
    'Time, result and network area of each check: the first three parts of an IPv4 address, or the first three groups of an IPv6 one. Never your full IP address, name or device.',
  aboutRecordOwner: "The document's owner sees how often it was checked, never by whom.",
  aboutRecordFiles: 'Files you check never leave your device.',
} as const;

/** The result page's title for each outcome, first thing a screen reader hears. */
export const outcomeTitles = {
  valid: 'Valid',
  superseded: 'Superseded',
  revoked: 'Revoked',
  expired: 'Expired',
  'not-found': 'Not found',
  malformed: 'Not a valid code',
  'rate-limited': 'Too many checks',
  unavailable: 'Cannot check now',
} as const;

/** Public reason categories of a revocation (ADR-010), as the result page names them. */
export const revokedReasons: Record<RevokedReason, string> = {
  'issued-in-error': 'Issued in error',
  withdrawn: 'Withdrawn',
  other: 'Other',
};

/** Names of the document types the verification API returns (`document.type`). */
export const documentTypeNames: Record<string, string> = {
  'acknowledgement-slip': 'Acknowledgement slip',
  'compliance-certificate': 'Compliance certificate',
  'clarification-letter': 'Clarification letter',
};

/** A document type's name; an unknown type reads as its words, e.g. `form-m-report` → "Form m report". */
export function documentTypeName(type: string): string {
  const known = documentTypeNames[type];
  if (known) return known;
  const words = type.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const verifyMessagesSw: Partial<Record<keyof typeof verifyMessages, string>> = {};
