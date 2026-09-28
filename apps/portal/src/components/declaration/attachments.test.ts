import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_MAX_BYTES,
  attachmentRows,
  contentTypeOf,
  initialUploads,
  type UploadsState,
  uploadsReducer,
} from './attachments';

const ITEM = 'item-1';

function picked(state: UploadsState = initialUploads, rejection: 'type' | 'size' | null = null) {
  return uploadsReducer(state, {
    type: 'picked',
    id: 'row-1',
    itemId: ITEM,
    name: 'deed.pdf',
    size: 2048,
    rejection,
  });
}

describe('contentTypeOf', () => {
  it('uses the browser type when it gives one', () => {
    expect(contentTypeOf({ name: 'deed.pdf', type: 'application/pdf' })).toBe('application/pdf');
  });

  it('falls back to the extension, e.g. HEIC photos with no type', () => {
    expect(contentTypeOf({ name: 'IMG_0001.HEIC', type: '' })).toBe('image/heic');
    expect(contentTypeOf({ name: 'logbook.jpg', type: '' })).toBe('image/jpeg');
    expect(contentTypeOf({ name: 'notes', type: '' })).toBe('application/octet-stream');
  });

  it('limits attachments to 20 MB', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('uploadsReducer', () => {
  it('starts an accepted file uploading at 0%', () => {
    expect(picked().rows).toEqual([
      { id: 'row-1', itemId: ITEM, name: 'deed.pdf', size: 2048, status: 'uploading', progress: 0 },
    ]);
  });

  it('shows a file the browser refused as rejected, without uploading it', () => {
    expect(picked(initialUploads, 'type').rows[0]?.status).toBe('rejected-type');
    expect(picked(initialUploads, 'size').rows[0]?.status).toBe('rejected-size');
  });

  it('moves from uploading with progress to scanning', () => {
    const uploading = uploadsReducer(picked(), { type: 'progress', id: 'row-1', percent: 42 });
    expect(uploading.rows[0]).toMatchObject({ status: 'uploading', progress: 42 });
    const scanning = uploadsReducer(uploading, { type: 'scanning', id: 'row-1' });
    expect(scanning.rows[0]?.status).toBe('scanning');
  });

  it('ignores progress once the file is being scanned', () => {
    const scanning = uploadsReducer(picked(), { type: 'scanning', id: 'row-1' });
    expect(uploadsReducer(scanning, { type: 'progress', id: 'row-1', percent: 99 })).toBe(scanning);
  });

  it.each(['infected', 'rejected-type', 'rejected-size', 'failed'] as const)(
    'ends a file that did not attach as %s',
    (outcome) => {
      const state = uploadsReducer(picked(), { type: 'finished', id: 'row-1', outcome });
      expect(state.rows[0]?.status).toBe(outcome);
    },
  );

  it('replaces the row with the linked file and remembers its size', () => {
    const state = uploadsReducer(picked(), {
      type: 'linked',
      id: 'row-1',
      uploadId: 'upload-1',
      size: 2048,
    });
    expect(state.rows).toEqual([]);
    expect(state.linked).toEqual({ 'upload-1': { size: 2048 } });
  });

  it('uploads a failed file again from 0%', () => {
    const failed = uploadsReducer(picked(), { type: 'finished', id: 'row-1', outcome: 'failed' });
    expect(uploadsReducer(failed, { type: 'retry', id: 'row-1' }).rows[0]).toMatchObject({
      status: 'uploading',
      progress: 0,
    });
  });

  it('only retries a failed file', () => {
    const infected = uploadsReducer(picked(), {
      type: 'finished',
      id: 'row-1',
      outcome: 'infected',
    });
    expect(uploadsReducer(infected, { type: 'retry', id: 'row-1' })).toBe(infected);
  });

  it('dismisses a file that did not attach', () => {
    const failed = uploadsReducer(picked(), { type: 'finished', id: 'row-1', outcome: 'failed' });
    expect(uploadsReducer(failed, { type: 'dismissed', id: 'row-1' }).rows).toEqual([]);
  });

  it('forgets a link once it is removed', () => {
    const linked = uploadsReducer(picked(), {
      type: 'linked',
      id: 'row-1',
      uploadId: 'upload-1',
      size: 2048,
    });
    expect(uploadsReducer(linked, { type: 'unlinked', uploadId: 'upload-1' }).linked).toEqual({});
  });
});

describe('attachmentRows', () => {
  it('lists the item linked files first, then its uploads in progress', () => {
    const state = uploadsReducer(picked(), { type: 'progress', id: 'row-1', percent: 30 });
    const withLink = { ...state, linked: { 'upload-1': { size: 1_500_000 } } };
    const rows = attachmentRows(
      ITEM,
      [
        { attachmentId: 'attachment-1', uploadId: 'upload-1', fileName: 'logbook.pdf', sha256: 'a'.repeat(64) },
        { attachmentId: 'attachment-2', uploadId: 'upload-2', fileName: 'old.pdf', sha256: 'b'.repeat(64) },
      ],
      withLink,
    );
    expect(rows).toEqual([
      { id: 'upload-1', name: 'logbook.pdf', status: 'linked', size: 1_500_000 },
      { id: 'upload-2', name: 'old.pdf', status: 'linked' },
      { id: 'row-1', name: 'deed.pdf', status: 'uploading', progress: 30 },
    ]);
  });

  it("leaves out other items' uploads", () => {
    expect(attachmentRows('item-2', [], picked())).toEqual([]);
  });
});
