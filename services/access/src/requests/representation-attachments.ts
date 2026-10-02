import type { Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';

import {
  ACCESS_REPRESENTATION_PURPOSE,
  DocumentsClient,
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../documents/documents-client.js';
import { badRequest, documentsUnavailable, type ProblemError } from '../problems.js';
import type { RepresentationAttachment } from './schema.js';

/**
 * The files attached to representations, made online by the declarant or received in writing and
 * entered by the access officer: clean uploads of purpose `access-representation`, kept from
 * documents' orphan sweep while attached.
 */

/**
 * Each upload, checked: clean, of purpose `access-representation`, and uploaded by `uploader`
 * (the declarant online, the access officer for representations received in writing), unless it
 * is attached already (`attached`: kept when the representations change hands, e.g. the
 * officer's scans when the declarant amends them online). 400 at `attachments.<n>` otherwise.
 */
export async function cleanAttachments(
  documents: DocumentsClient,
  tenant: string,
  uploadIds: readonly string[],
  uploader: string,
  attached: readonly RepresentationAttachment[],
): Promise<RepresentationAttachment[]> {
  const errors: ProblemError[] = [];
  const attachments: RepresentationAttachment[] = [];
  for (const [index, uploadId] of uploadIds.entries()) {
    const kept = attached.find((attachment) => attachment.uploadId === uploadId);
    if (kept) {
      attachments.push({ uploadId, fileName: kept.fileName });
      continue;
    }
    const path = `attachments.${String(index)}`;
    try {
      const upload = await documents.getCleanUpload(tenant, uploadId);
      if (upload.purpose !== ACCESS_REPRESENTATION_PURPOSE) {
        errors.push({ path, message: `is not an upload for ${ACCESS_REPRESENTATION_PURPOSE}` });
      } else if (upload.uploadedBy !== uploader) {
        errors.push({ path, message: 'is not an upload of yours' });
      } else {
        attachments.push({ uploadId, fileName: upload.fileName ?? 'attachment' });
      }
    } catch (error) {
      if (error instanceof UploadNotFound) {
        errors.push({ path, message: 'is not an upload of yours' });
      } else if (error instanceof UploadNotClean) {
        errors.push({ path, message: 'is not clean: still being scanned, or refused' });
      } else if (error instanceof DocumentsUnavailable) {
        throw documentsUnavailable();
      } else {
        throw error;
      }
    }
  }
  if (errors.length > 0) throw badRequest('Some attachments cannot be used.', errors);
  return attachments;
}

/** Keeps the uploads from documents' orphan sweep; before the save, so none is lost after it. */
export async function linkUploads(
  documents: DocumentsClient,
  tenant: string,
  uploadIds: readonly string[],
): Promise<void> {
  try {
    for (const uploadId of uploadIds) await documents.markLinked(tenant, uploadId);
  } catch (error) {
    if (error instanceof DocumentsUnavailable) throw documentsUnavailable();
    throw error;
  }
}

/** Releases uploads taken off to the orphan sweep; a failure only leaves them kept. */
export async function releaseUploads(
  documents: DocumentsClient,
  logger: Logger,
  tenant: string,
  uploadIds: readonly string[],
): Promise<void> {
  for (const uploadId of uploadIds) {
    try {
      await documents.markUnlinked(tenant, uploadId);
    } catch (error) {
      logger.warn({ uploadId, err: errorType(error) }, 'Could not release an attachment');
    }
  }
}

/** The uploads of `previous` no longer among `kept`: released after the save. */
export function releasedUploads(
  previous: readonly RepresentationAttachment[],
  kept: readonly string[],
): string[] {
  const keep = new Set(kept);
  return previous.map((attachment) => attachment.uploadId).filter((id) => !keep.has(id));
}
