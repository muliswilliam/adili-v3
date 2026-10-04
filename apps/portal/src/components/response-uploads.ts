import { useState } from 'react';

import {
  completeAttachmentUpload,
  createAttachmentUpload,
  getAttachmentUpload,
} from '../server/documents/uploads';
import type { AttachmentPurpose } from '../server/documents/uploads.server';
import {
  putToPresignedUrl,
  uploadAttachment,
  type UploadSteps,
} from './declaration/attachment-upload';
import type { UploadsEvent } from './declaration/attachments';

/** The purposes whose documents are tied to a response when it is sent, not linked one by one. */
export type ResponsePurpose = Exclude<AttachmentPurpose, 'declaration-attachment'>;

export interface ResponseUploads {
  /** Lists a picked file under `itemId` and, unless the browser refused it, uploads it. */
  attach: (itemId: string, file: File, rejection: 'type' | 'size' | null) => void;
  /** Uploads a failed file again. */
  retry: (rowId: string) => void;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads the documents of a response (a clarification's points, a notice, representations on an
 * access request) as `purpose`, through the declaration attachment flow, reporting each step to
 * `dispatch`. A file counts as "linked" once it is clean: the service ties it to the response when
 * the response is sent, so there is nothing to link before.
 */
export function useResponseUploads(
  purpose: ResponsePurpose,
  dispatch: (event: UploadsEvent) => void,
): ResponseUploads {
  // The picked files by row id, to upload a failed one again.
  const [files] = useState(() => new Map<string, File>());

  function start(rowId: string, file: File) {
    const steps: UploadSteps = {
      reserve: (picked) => createAttachmentUpload({ data: { ...picked, purpose } }),
      put: putToPresignedUrl,
      complete: (uploadId) => completeAttachmentUpload({ data: { uploadId } }),
      check: (uploadId) => getAttachmentUpload({ data: { uploadId } }),
      link: () => Promise.resolve({ status: 'linked', size: file.size }),
      wait,
    };
    void uploadAttachment(rowId, file, steps, (event) => {
      if (event.type === 'linked') files.delete(rowId);
      dispatch(event);
    });
  }

  return {
    attach: (itemId, file, rejection) => {
      const rowId = crypto.randomUUID();
      dispatch({ type: 'picked', id: rowId, itemId, name: file.name, size: file.size, rejection });
      if (rejection) return;
      files.set(rowId, file);
      start(rowId, file);
    },
    retry: (rowId) => {
      const file = files.get(rowId);
      if (!file) return;
      dispatch({ type: 'retry', id: rowId });
      start(rowId, file);
    },
  };
}
