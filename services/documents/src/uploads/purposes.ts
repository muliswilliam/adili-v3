import { ACCESS_OFFICER, DECLARANT, REPORTING_OFFICER } from '@adili/roles';
import { z } from 'zod';

/** CSV as declared by clients and as detected by the sniffer. */
export const CSV = 'text/csv';
/** Office Open XML workbook (.xlsx). */
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF = 'application/pdf';
export const JPEG = 'image/jpeg';
export const PNG = 'image/png';
/** HEIF holding HEVC images, as phone cameras save photos. */
export const HEIC = 'image/heic';

export type DetectedType =
  typeof CSV | typeof XLSX | typeof PDF | typeof JPEG | typeof PNG | typeof HEIC;

export interface UploadPurposePolicy {
  /** Realm roles that may upload for this purpose, and read or complete such uploads. */
  roles: readonly string[];
  /** Declared content types accepted; the sniffed type must equal the declared one. */
  contentTypes: readonly DetectedType[];
  /** Bytes. */
  maxSize: number;
  /**
   * Only the caller who reserved an upload may read or complete it: a declarant's evidence is
   * theirs, not every declarant's of the Commission. Otherwise anyone of the tenant whose roles
   * cover the purpose may.
   */
  uploaderOnly: boolean;
  /**
   * The owning service links clean uploads to its records (`markUploadLinked`); the orphan sweep
   * deletes a clean upload left without a link for 30 days.
   */
  linked: boolean;
}

const MB = 1024 * 1024;

/**
 * What each upload purpose allows. The purpose, never the file name, decides the object key
 * prefix, the accepted types and the size limit (ADR-002). Later specs add their purposes here.
 */
export const UPLOAD_PURPOSES = {
  'roster-import': {
    roles: [REPORTING_OFFICER],
    contentTypes: [CSV, XLSX],
    maxSize: 50 * MB,
    uploaderOnly: false,
    linked: false,
  },
  /** Evidence on a declaration item: a title deed, logbook, statement or payslip (spec 05). */
  'declaration-attachment': {
    roles: [DECLARANT],
    contentTypes: [PDF, JPEG, PNG, HEIC],
    maxSize: 20 * MB,
    uploaderOnly: true,
    linked: true,
  },
  /**
   * Evidence the declarant attaches to their response to a clarification (spec 07a). The review
   * service checks each one at the response (clean, this purpose) and keeps its name and hash
   * with the response, so it records no link and the orphan sweep leaves these alone.
   */
  'clarification-attachment': {
    roles: [DECLARANT],
    contentTypes: [PDF, JPEG, PNG, HEIC],
    maxSize: 20 * MB,
    uploaderOnly: true,
    linked: false,
  },
  /**
   * Evidence with a declarant's representations on an access request: a letter, a court order;
   * or, uploaded by the access officer recording a written self-access application, a
   * representative's written authority and ID (spec 10). The access service links it to the
   * representations or the application, and takes only the caller's own uploads. The name
   * predates the officer's uploads and is kept: it is in stored uploads, their object keys and
   * the contract.
   */
  'access-representation': {
    roles: [DECLARANT, ACCESS_OFFICER],
    contentTypes: [PDF, JPEG, PNG, HEIC],
    maxSize: 20 * MB,
    uploaderOnly: true,
    linked: true,
  },
} as const satisfies Record<string, UploadPurposePolicy>;

export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

export const uploadPurposeSchema = z
  .enum(Object.keys(UPLOAD_PURPOSES) as [UploadPurpose, ...UploadPurpose[]])
  .meta({ description: 'Sets allowed content types and the size limit' });

export function policyOf(purpose: UploadPurpose): UploadPurposePolicy {
  return UPLOAD_PURPOSES[purpose];
}

/** Purposes whose clean uploads the orphan sweep deletes when no link is recorded. */
export const LINKED_PURPOSES = (Object.keys(UPLOAD_PURPOSES) as UploadPurpose[]).filter(
  (purpose) => policyOf(purpose).linked,
);

/** Purposes whose uploads `roles` may create, read and complete. */
export function purposesFor(roles: readonly string[]): UploadPurpose[] {
  return (Object.keys(UPLOAD_PURPOSES) as UploadPurpose[]).filter((purpose) =>
    policyOf(purpose).roles.some((role) => roles.includes(role)),
  );
}
