import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import { mockDocumentsFetch, receiveMockUpload, resetDocumentsMock } from './documents/mock.server';
import type { paths as DocumentsPaths } from './documents/schema.gen';
import type { CreateUpload, UploadPurpose } from './documents/types';
import { loadMyNotices, respondToNotice } from './notices.server';
import { failNextNoticeResponse, MOCK_NOTICE_IDS as IDS } from './review/notices-mock.server';
import { mockReviewFetch, resetReviewMock } from './review/mock.server';
import type { paths } from './review/schema.gen';

const NOW = Date.parse('2026-09-28T09:00:00Z');

const client = createClient<paths>({ baseUrl: 'http://review.test', fetch: mockReviewFetch });
const documents = createClient<DocumentsPaths>({
  baseUrl: 'http://documents.test',
  fetch: mockDocumentsFetch,
});

async function cleanUpload(purpose: UploadPurpose = 'action-response') {
  const { data } = await documents.POST('/v1/uploads', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: {
      purpose,
      contentType: 'application/pdf',
      declaredSize: 1000,
      fileName: 'sick-note.pdf',
    } satisfies CreateUpload as never,
  });
  if (!data) throw new Error('not reserved');
  receiveMockUpload(data.id, 1000);
  await documents.POST('/v1/uploads/{id}/complete', {
    params: { path: { id: data.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
  });
  return data.id;
}

beforeEach(() => {
  resetReviewMock(NOW);
  resetDocumentsMock();
});

describe('loadMyNotices (S17)', () => {
  it('returns every notice issued to the declarant, newest first', async () => {
    const result = await loadMyNotices(client);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.notices.map((notice) => notice.actionId)).toEqual([
      IDS.warning,
      IDS.noticeOpen,
      IDS.noticeResponded,
      IDS.complied,
    ]);
  });

  it('is unavailable when the service does not answer', async () => {
    const down = createClient<paths>({
      baseUrl: 'http://review.test',
      fetch: () => Promise.reject(new Error('down')),
    });
    expect(await loadMyNotices(down)).toEqual({ status: 'unavailable' });
  });
});

describe('respondToNotice (S9)', () => {
  it('records the text and a document once; a replay answers the same', async () => {
    const upload = await cleanUpload();
    const key = crypto.randomUUID();
    const result = await respondToNotice(
      client,
      IDS.noticeOpen,
      { text: 'I was in hospital.', attachments: [upload] },
      key,
    );
    if (result.status !== 'responded') throw new Error(result.status);
    expect(result.notice.status).toBe('responded');
    expect(result.notice.response).toMatchObject({
      text: 'I was in hospital.',
      attachments: [{ uploadId: upload, fileName: 'sick-note.pdf' }],
    });
    const again = await respondToNotice(
      client,
      IDS.noticeOpen,
      { text: 'I was in hospital.', attachments: [upload] },
      key,
    );
    expect(again.status).toBe('responded');

    const second = await respondToNotice(
      client,
      IDS.noticeOpen,
      { text: 'Again', attachments: [] },
      crypto.randomUUID(),
    );
    expect(second).toEqual({ status: 'conflict', reason: 'already-responded' });
  });

  it('refuses a closed notice and an attachment of another purpose', async () => {
    expect(
      await respondToNotice(
        client,
        IDS.complied,
        { text: 'Too late', attachments: [] },
        crypto.randomUUID(),
      ),
    ).toEqual({ status: 'conflict', reason: 'notice-closed' });
    const other = await cleanUpload('clarification-attachment');
    expect(
      await respondToNotice(
        client,
        IDS.warning,
        { text: 'Here', attachments: [other] },
        crypto.randomUUID(),
      ),
    ).toEqual({ status: 'conflict', reason: 'attachment-not-accepted' });
  });

  it('is unavailable when the service is down, and not found for another notice', async () => {
    failNextNoticeResponse();
    expect(
      await respondToNotice(
        client,
        IDS.warning,
        { text: 'Here', attachments: [] },
        crypto.randomUUID(),
      ),
    ).toEqual({
      status: 'unavailable',
    });
    expect(
      await respondToNotice(
        client,
        '00000000-0000-4000-8000-000000000000',
        { text: 'Here', attachments: [] },
        crypto.randomUUID(),
      ),
    ).toEqual({ status: 'not-found' });
  });
});
