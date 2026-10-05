import { type putFile, wholePercents } from '@adili/ui';

import type { Unauthenticated } from '../../server/results';
import type {
  AttachmentFile,
  ReserveResult,
  UploadCheck,
} from '../../server/documents/uploads.server';
import { contentTypeOf, type UploadEnd, type UploadsEvent } from './attachments';

/**
 * Uploading one declaration attachment, end to end: reserve an upload, PUT the bytes straight
 * to storage with progress, complete it (the scan) and poll until it is final, then link it to
 * the item. Reports each step as an `UploadsEvent`. The steps are injected so this is testable;
 * `item-attachments.tsx` wires them to the server functions and the shared `putFile`.
 */

export const SCAN_POLL_MS = 1_000;
/** About a minute of "Checking the file…" before giving up. */
export const SCAN_POLL_LIMIT = 60;

export type LinkOutcome =
  | { status: 'linked'; size: number }
  | {
      status: 'failed';
    };

export interface UploadSteps {
  reserve: (file: AttachmentFile) => Promise<ReserveResult | Unauthenticated>;
  put: typeof putFile;
  complete: (uploadId: string) => Promise<UploadCheck | Unauthenticated>;
  check: (uploadId: string) => Promise<UploadCheck | Unauthenticated>;
  link: (uploadId: string) => Promise<LinkOutcome>;
  wait: (ms: number) => Promise<void>;
}

function endOf(check: UploadCheck | Unauthenticated): UploadEnd | null {
  switch (check.status) {
    case 'clean':
    case 'scanning':
      return null;
    case 'infected':
      return 'infected';
    case 'rejected':
      if (check.reason === 'type') return 'rejected-type';
      if (check.reason === 'size') return 'rejected-size';
      return 'failed';
    default:
      return 'failed';
  }
}

export async function uploadAttachment(
  rowId: string,
  file: File,
  steps: UploadSteps,
  emit: (event: UploadsEvent) => void,
): Promise<void> {
  const finish = (outcome: UploadEnd) => {
    emit({ type: 'finished', id: rowId, outcome });
  };
  const contentType = contentTypeOf(file);

  const reserved = await steps.reserve({ contentType, size: file.size, fileName: file.name });
  if (reserved.status === 'rejected') {
    finish(reserved.reason === 'size' ? 'rejected-size' : 'rejected-type');
    return;
  }
  if (reserved.status !== 'reserved') {
    finish('failed');
    return;
  }
  const { id: uploadId, uploadUrl } = reserved.reservation;

  const put = await steps.put(uploadUrl, file, contentType, {
    onProgress: wholePercents((percent) => {
      emit({ type: 'progress', id: rowId, percent });
    }),
  });
  if (put !== 'ok') {
    finish('failed');
    return;
  }

  emit({ type: 'scanning', id: rowId });
  let check = await steps.complete(uploadId);
  for (let polls = 0; check.status === 'scanning'; polls += 1) {
    if (polls === SCAN_POLL_LIMIT) {
      finish('failed');
      return;
    }
    await steps.wait(SCAN_POLL_MS);
    check = await steps.check(uploadId);
  }
  const end = endOf(check);
  if (end) {
    finish(end);
    return;
  }

  const linked = await steps.link(uploadId);
  if (linked.status !== 'linked') {
    finish('failed');
    return;
  }
  emit({ type: 'linked', id: rowId, uploadId, size: linked.size });
}

