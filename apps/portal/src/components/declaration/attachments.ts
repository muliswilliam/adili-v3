import type { AttachmentListItem } from '@adili/ui';

import type { Attachment, Draft } from './contents';

/**
 * Documents attached to assets and liabilities (#125): what the browser accepts, and the pure
 * state of the files being uploaded. A file goes uploading (with progress) -> scanning -> linked,
 * or ends infected, rejected (type or size) or failed. Linked files live in the item's
 * `attachments`; this state keeps the ones on their way and what linking told us about them.
 */

/** Spec: PDF, JPEG, PNG or HEIC, up to 20 MB. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

const TYPES_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

/** Extensions and MIME types; HEIC photos often have no type in the browser, so both. */
export const ATTACHMENT_ACCEPT = [
  ...Object.keys(TYPES_BY_EXTENSION).map((extension) => `.${extension}`),
  ...new Set(Object.values(TYPES_BY_EXTENSION)),
];

export const ATTACHMENT_COPY = {
  heading: 'Documents',
  hint: 'Optional. A title deed, logbook, statement or payslip helps your Commission verify this item.',
  addHint: 'PDF, JPEG, PNG or HEIC, up to 20 MB.',
  removed: 'Document removed',
  removeFailed: 'The document could not be removed. Try again.',
};

/** The content type to declare: the browser's, or the one the extension implies. */
export function contentTypeOf(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPES_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** A file on its way; once linked it leaves this list for the item's `attachments`. */
export type UploadStatus =
  'uploading' | 'scanning' | 'infected' | 'rejected-type' | 'rejected-size' | 'failed';

export type UploadEnd = Extract<
  UploadStatus,
  'infected' | 'rejected-type' | 'rejected-size' | 'failed'
>;

export interface UploadRow {
  /** Local id, until the file has an upload id. */
  id: string;
  itemId: string;
  name: string;
  size: number;
  status: UploadStatus;
  progress: number;
}

/** What linking told us that the item's attachment reference does not carry. */
export interface LinkedFile {
  attachmentId: string;
  size: number;
}

export interface UploadsState {
  rows: UploadRow[];
  /** By upload id; unknown for files linked before this page load. */
  linked: Record<string, LinkedFile>;
}

export const initialUploads: UploadsState = { rows: [], linked: {} };

export type UploadsEvent =
  | {
      type: 'picked';
      id: string;
      itemId: string;
      name: string;
      size: number;
      /** Why the browser refused it before any request, if it did. */
      rejection: 'type' | 'size' | null;
    }
  | { type: 'progress'; id: string; percent: number }
  | { type: 'scanning'; id: string }
  | { type: 'finished'; id: string; outcome: UploadEnd }
  | { type: 'linked'; id: string; uploadId: string; attachmentId: string; size: number }
  | { type: 'retry'; id: string }
  | { type: 'dismissed'; id: string }
  | { type: 'unlinked'; uploadId: string };

function updateRow(
  state: UploadsState,
  id: string,
  change: (row: UploadRow) => UploadRow | null,
): UploadsState {
  const row = state.rows.find((candidate) => candidate.id === id);
  if (!row) return state;
  const next = change(row);
  if (next === row) return state;
  return {
    ...state,
    rows: next
      ? state.rows.map((candidate) => (candidate.id === id ? next : candidate))
      : state.rows.filter((candidate) => candidate.id !== id),
  };
}

export function uploadsReducer(state: UploadsState, event: UploadsEvent): UploadsState {
  switch (event.type) {
    case 'picked': {
      const status: UploadStatus =
        event.rejection === 'type'
          ? 'rejected-type'
          : event.rejection === 'size'
            ? 'rejected-size'
            : 'uploading';
      const row: UploadRow = {
        id: event.id,
        itemId: event.itemId,
        name: event.name,
        size: event.size,
        status,
        progress: 0,
      };
      return { ...state, rows: [...state.rows, row] };
    }
    case 'progress':
      return updateRow(state, event.id, (row) =>
        row.status === 'uploading' && row.progress !== event.percent
          ? { ...row, progress: event.percent }
          : row,
      );
    case 'scanning':
      return updateRow(state, event.id, (row) =>
        row.status === 'scanning' ? row : { ...row, status: 'scanning' },
      );
    case 'finished':
      return updateRow(state, event.id, (row) => ({ ...row, status: event.outcome }));
    case 'linked': {
      const without = updateRow(state, event.id, () => null);
      return {
        ...without,
        linked: {
          ...without.linked,
          [event.uploadId]: { attachmentId: event.attachmentId, size: event.size },
        },
      };
    }
    case 'retry':
      return updateRow(state, event.id, (row) =>
        row.status === 'failed' ? { ...row, status: 'uploading', progress: 0 } : row,
      );
    case 'dismissed':
      return updateRow(state, event.id, () => null);
    case 'unlinked': {
      if (!(event.uploadId in state.linked)) return state;
      const linked = Object.fromEntries(
        Object.entries(state.linked).filter(([uploadId]) => uploadId !== event.uploadId),
      );
      return { ...state, linked };
    }
  }
}

/** The rows AttachmentList shows for one item: its linked files, then those on their way. */
export function attachmentRows(
  itemId: string,
  attachments: Draft<Attachment>[],
  state: UploadsState,
): AttachmentListItem[] {
  const linked = attachments.flatMap((attachment): AttachmentListItem[] => {
    if (!attachment.uploadId) return [];
    const size = state.linked[attachment.uploadId]?.size;
    return [
      {
        id: attachment.uploadId,
        name: attachment.fileName ?? 'Document',
        status: 'linked',
        ...(size === undefined ? {} : { size }),
      },
    ];
  });
  const uploading = state.rows
    .filter((row) => row.itemId === itemId)
    .map((row): AttachmentListItem => ({
      id: row.id,
      name: row.name,
      status: row.status,
      ...(row.status === 'uploading' ? { progress: row.progress } : {}),
    }));
  return [...linked, ...uploading];
}
