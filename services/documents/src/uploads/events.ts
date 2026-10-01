import type { NewEvent } from '@adili/events';

import type { UploadPurpose } from './purposes.js';

/**
 * The audit record of the writes to an upload another service relies on (ADR-008): an owning
 * service linking or unlinking it, and the orphan sweep deleting it. Identifiers only, never the
 * file name or hash. The `tenant` extension is the upload's tenant; the subject is the upload.
 */

export const UPLOAD_LINKED = 'upload.linked.v1';
export const UPLOAD_UNLINKED = 'upload.unlinked.v1';
export const UPLOAD_DELETED = 'upload.deleted.v1';

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
