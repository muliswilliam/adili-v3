import { z } from 'zod';

/** CSV as declared by clients and as detected by the sniffer. */
export const CSV = 'text/csv';
/** Office Open XML workbook (.xlsx). */
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type DetectedType = typeof CSV | typeof XLSX;

export interface UploadPurposePolicy {
  /** Realm roles that may upload for this purpose, and read or complete such uploads. */
  roles: readonly string[];
  /** Declared content types accepted; the sniffed type must equal the declared one. */
  contentTypes: readonly DetectedType[];
  /** Bytes. */
  maxSize: number;
}

const MB = 1024 * 1024;

/**
 * What each upload purpose allows. The purpose, never the file name, decides the object key
 * prefix, the accepted types and the size limit (ADR-002). Later specs add their purposes here.
 */
export const UPLOAD_PURPOSES = {
  'roster-import': {
    roles: ['reporting-officer'],
    contentTypes: [CSV, XLSX],
    maxSize: 50 * MB,
  },
} as const satisfies Record<string, UploadPurposePolicy>;

export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

export const uploadPurposeSchema = z
  .enum(Object.keys(UPLOAD_PURPOSES) as [UploadPurpose, ...UploadPurpose[]])
  .meta({ description: 'Sets allowed content types and the size limit' });

export function policyOf(purpose: UploadPurpose): UploadPurposePolicy {
  return UPLOAD_PURPOSES[purpose];
}

/** Purposes whose uploads `roles` may create, read and complete. */
export function purposesFor(roles: readonly string[]): UploadPurpose[] {
  return (Object.keys(UPLOAD_PURPOSES) as UploadPurpose[]).filter((purpose) =>
    policyOf(purpose).roles.some((role) => roles.includes(role)),
  );
}
