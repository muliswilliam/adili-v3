import { addDays } from '@adili/ui';
import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadClarificationPage,
  loadMyClarifications,
  respondToClarification,
} from './clarifications.server';
import { mockDocumentsFetch, receiveMockUpload, resetDocumentsMock } from './documents/mock.server';
import type { paths as DocumentsPaths } from './documents/schema.gen';
import type { CreateUpload, UploadPurpose } from './documents/types';
import {
  failNextResponse,
  MOCK_CLARIFICATION_IDS as IDS,
  mockReviewFetch,
  resetReviewMock,
} from './review/mock.server';
import type { paths } from './review/schema.gen';

const NOW = Date.parse('2026-09-28T09:00:00Z');

function client(send: (request: Request) => Promise<Response> = mockReviewFetch) {
  return createClient<paths>({ baseUrl: 'http://review.test', fetch: send });
}

const documents = createClient<DocumentsPaths>({
  baseUrl: 'http://documents.test',
  fetch: mockDocumentsFetch,
});

async function cleanUpload(fileName = 'statement.pdf', purpose = 'clarification-attachment') {
  const { data } = await documents.POST('/v1/uploads', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: {
      purpose: purpose as UploadPurpose,
      contentType: 'application/pdf',
      declaredSize: 1000,
      fileName,
    } satisfies CreateUpload as never,
  });
  if (!data) throw new Error('not reserved');
  receiveMockUpload(data.id, 1000);
  await documents.POST('/v1/uploads/{id}/complete', {
    params: { path: { id: data.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
  });
  return data.id;
}

const KEY = '3f0c9d6e-2a1b-4c5d-8e7f-000000000001';

beforeEach(() => {
  resetReviewMock(NOW);
  resetDocumentsMock();
});

describe('loadClarificationPage', () => {
  it('returns the clarification with its letter, items and due date (S14)', async () => {
    const page = await loadClarificationPage(client(), IDS.open);
    if (page.status !== 'ok') throw new Error(page.status);
    expect(page.clarification.reference).toMatch(/^CLR-TSC-2026-/);
    expect(page.clarification.items).toHaveLength(2);
    expect(page.clarification.dueAt).toBe('2026-10-20T09:00:00.000Z');
    expect(page.clarification.letterDownloadUrl).toBe(`/api/mock-letters/${IDS.open}`);
    expect(page.followUps).toEqual([]);
    expect(page.original).toBeNull();
  });

  it('links a follow-up and the clarification it follows up', async () => {
    const original = await loadClarificationPage(client(), IDS.answered);
    const further = await loadClarificationPage(client(), IDS.further);
    if (original.status !== 'ok' || further.status !== 'ok') throw new Error('not ok');
    expect(original.followUps).toEqual([
      { id: IDS.further, reference: further.clarification.reference },
    ]);
    expect(further.original).toEqual({
      id: IDS.answered,
      reference: original.clarification.reference,
    });
  });

  it('still shows the clarification when the list for follow-ups cannot load', async () => {
    const listDown = client((request) =>
      new URL(request.url).pathname === '/v1/me/clarifications'
        ? Promise.reject(new Error('offline'))
        : mockReviewFetch(request),
    );
    const page = await loadClarificationPage(listDown, IDS.answered);
    expect(page.status).toBe('ok');
  });

  it('is not found for someone else’s or an unknown clarification, unavailable when down', async () => {
    expect(await loadClarificationPage(client(), '00000000-0000-4000-8000-000000000000')).toEqual({
      status: 'not-found',
    });
    const down = client(() => Promise.reject(new Error('offline')));
    expect(await loadClarificationPage(down, IDS.open)).toEqual({ status: 'unavailable' });
  });
});

describe('loadMyClarifications', () => {
  it('returns every clarification the declarant was sent, newest first', async () => {
    const result = await loadMyClarifications(client());
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.clarifications.map((each) => each.id)).toContain(IDS.open);
    expect(result.clarifications).toHaveLength(Object.keys(IDS).length);
    expect(result.clarifications.some((each) => each.status === 'draft')).toBe(false);
    const issued = result.clarifications.map((each) => each.issuedAt ?? '');
    expect(issued).toEqual([...issued].sort().reverse());
  });

  it('is unavailable when the service is down or fails', async () => {
    const down = client(() => Promise.reject(new Error('offline')));
    expect(await loadMyClarifications(down)).toEqual({ status: 'unavailable' });
    const failing = client(() =>
      Promise.resolve(new Response(JSON.stringify({ title: 'Down' }), { status: 503 })),
    );
    expect(await loadMyClarifications(failing)).toEqual({ status: 'unavailable' });
  });
});

describe('respondToClarification', () => {
  const answers = (attachments: string[] = []) => [
    { index: 0, text: 'Built a house with a SACCO loan.', attachments },
    { index: 1, text: 'Loan from Mwalimu SACCO.', attachments: [] },
  ];

  it('responds with per-point text and two clean attachments (S14)', async () => {
    const files = [await cleanUpload('boq.pdf'), await cleanUpload('loan.pdf')];
    const result = await respondToClarification(client(), IDS.open, answers(files), KEY);
    if (result.status !== 'responded') throw new Error(result.status);
    expect(result.clarification.status).toBe('responded');
    expect(result.clarification.responseLate).toBe(false);
    expect(result.clarification.response?.items[0]?.attachments.map((a) => a.fileName)).toEqual([
      'boq.pdf',
      'loan.pdf',
    ]);
  });

  describe('on a wall clock past the seeded windows', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('responds as of when the mock was seeded, not the wall clock', async () => {
      // Seeded as of NOW, but run a month later: the clarification is past due by the wall clock.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.parse(addDays(new Date(NOW).toISOString(), 30)));
      resetReviewMock(NOW);
      const result = await respondToClarification(client(), IDS.open, answers(), KEY);
      if (result.status !== 'responded') throw new Error(result.status);
      expect(result.clarification).toMatchObject({
        respondedAt: '2026-09-28T09:00:00.000Z',
        responseLate: false,
      });
    });
  });

  it('replays the first answer for the same key, and refuses a second response (409)', async () => {
    const first = await respondToClarification(client(), IDS.open, answers(), KEY);
    expect(first.status).toBe('responded');
    expect((await respondToClarification(client(), IDS.open, answers(), KEY)).status).toBe(
      'responded',
    );
    expect(
      await respondToClarification(
        client(),
        IDS.open,
        answers(),
        '3f0c9d6e-2a1b-4c5d-8e7f-000000000002',
      ),
    ).toEqual({ status: 'conflict', reason: 'already-responded' });
  });

  it('accepts a response after the due date and marks it late', async () => {
    const result = await respondToClarification(
      client(),
      IDS.overdue,
      [{ index: 0, text: 'Loan details attached.', attachments: [] }],
      KEY,
    );
    if (result.status !== 'responded') throw new Error(result.status);
    expect(result.clarification.responseLate).toBe(true);
  });

  it('refuses an attachment that is not clean (409)', async () => {
    const infected = await cleanUpload('virus.pdf');
    expect(await respondToClarification(client(), IDS.open, answers([infected]), KEY)).toEqual({
      status: 'conflict',
      reason: 'attachment-not-clean',
    });
  });

  it('refuses a response to a withdrawn clarification', async () => {
    expect(
      await respondToClarification(
        client(),
        IDS.withdrawn,
        [{ index: 0, text: 'x', attachments: [] }],
        KEY,
      ),
    ).toEqual({ status: 'conflict', reason: 'not-open' });
  });

  it('is unavailable when the service fails, so the declarant can try again', async () => {
    failNextResponse();
    expect(await respondToClarification(client(), IDS.open, answers(), KEY)).toEqual({
      status: 'unavailable',
    });
    expect((await respondToClarification(client(), IDS.open, answers(), KEY)).status).toBe(
      'responded',
    );
  });
});
