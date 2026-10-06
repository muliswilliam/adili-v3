import type { NewEvent } from '@adili/events';

import type { UploadPurpose } from './purposes.js';
import type { UploadRejection } from './schema.js';

/**
 * The audit record of every write to an upload (ADR-008): its reservation and completion by the
 * uploader, the expiry sweep, an owning service linking or unlinking it, and the orphan sweep
 * deleting it. Identifiers, purpose and outcome only, never the file name, hash or threat. The
 * `tenant` extension is the upload's tenant; the subject is the upload.
 */

export const UPLOAD_RESERVED = 'upload.reserved.v1';
export const UPLOAD_COMPLETED = 'upload.completed.v1';
export const UPLOAD_EXPIRED = 'upload.expired.v1';
export const UPLOAD_LINKED = 'upload.linked.v1';
export const UPLOAD_UNLINKED = 'upload.unlinked.v1';
export const UPLOAD_DELETED = 'upload.deleted.v1';

export interface UploadReservedData extends Record<string, unknown> {
  uploadId: string;
  purpose: UploadPurpose;
  /** The subject of the user who reserved it. */
  reservedBy: string;
}

export interface UploadCompletedData extends Record<string, unknown> {
  uploadId: string;
  purpose: UploadPurpose;
  outcome: 'clean' | 'infected' | 'rejected';
  /** Why a `rejected` upload was refused; null otherwise. */
  rejection: UploadRejection | null;
  /** The subject of the user who completed it. */
  completedBy: string;
}

export interface UploadExpiredData extends Record<string, unknown> {
  uploadId: string;
  purpose: UploadPurpose;
}

export interface UploadLinkedData extends Record<string, unknown> {
  uploadId: string;
  purpose: UploadPurpose;
  /** The client id of the service that linked it. */
  linkedBy: string;
}

export interface UploadUnlinkedData extends Record<string, unknown> {
  uploadId: string;
  purpose: UploadPurpose;
  /** The client id of the service that took its link back. */
  unlinkedBy: string;
}

export interface UploadDeletedData extends Record<string, unknown> {
  uploadId: string;
  purpose: UploadPurpose;
  /** `orphaned`: no link for 30 days, so the sweep deleted the object. */
  reason: 'orphaned';
}

export function uploadReserved(
  tenant: string,
  data: UploadReservedData,
): NewEvent<UploadReservedData> {
  return { type: UPLOAD_RESERVED, subject: data.uploadId, tenant, data };
}

export function uploadCompleted(
  tenant: string,
  data: UploadCompletedData,
): NewEvent<UploadCompletedData> {
  return { type: UPLOAD_COMPLETED, subject: data.uploadId, tenant, data };
}

export function uploadExpired(
  tenant: string,
  data: UploadExpiredData,
): NewEvent<UploadExpiredData> {
  return { type: UPLOAD_EXPIRED, subject: data.uploadId, tenant, data };
}

export function uploadLinked(tenant: string, data: UploadLinkedData): NewEvent<UploadLinkedData> {
  return { type: UPLOAD_LINKED, subject: data.uploadId, tenant, data };
}

export function uploadUnlinked(
  tenant: string,
  data: UploadUnlinkedData,
): NewEvent<UploadUnlinkedData> {
  return { type: UPLOAD_UNLINKED, subject: data.uploadId, tenant, data };
}

export function uploadDeleted(
  tenant: string,
  data: UploadDeletedData,
): NewEvent<UploadDeletedData> {
  return { type: UPLOAD_DELETED, subject: data.uploadId, tenant, data };
}
