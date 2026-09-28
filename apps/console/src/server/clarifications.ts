import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import {
  type ClarificationDetail,
  loadClarificationDetail,
  raiseFollowUp,
  resolve,
  type ServiceResult,
  withdraw,
} from './clarifications.server';
import { callDirectory as callService } from './directory/client';
import { createDocumentsClient } from './documents/client';
import { env } from './env.server';
import { type Clarification, createReviewClient, type ReviewClient } from './review/client';

/**
 * Server functions for a clarification on a review case (spec 07a FE-4, S15), called as the
 * signed-in reviewer or supervisor. Tokens stay on the server; downloads come back as short-lived links.
 */

type Send = (request: Request) => Promise<Response>;

/** The in-memory mock when REVIEW_MOCK is on in development, else the network. */
function mockSend(pick: 'review' | 'documents'): Send | undefined {
  // `import.meta.env.DEV` is `false` in production builds, so the bundler drops this branch and
  // the mock's chunk with it; keep the check inline for that to work.
  if (import.meta.env.DEV && process.env.NODE_ENV !== 'production' && env().REVIEW_MOCK) {
    return async (request) => {
      const mock = await import('./review/mock.server');
      return pick === 'review' ? mock.mockReviewFetch(request) : mock.mockDocumentsFetch(request);
    };
  }
  return undefined;
}

async function asReviewer<T>(
  work: (client: ReviewClient, subject: string, accessToken: string) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
  const send = mockSend('review');
  const client = createReviewClient({
    baseUrl: env().REVIEW_API_URL,
    accessToken: session.accessToken,
    ...(send ? { fetch: send } : {}),
  });
  return work(client, session.user.subject, session.accessToken);
}

const id = z.uuid();

export type ClarificationDetailLoad = ServiceResult<ClarificationDetail> & { now: string };

export const getClarificationDetail = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id, clarificationId: id }))
  .handler(async ({ data }): Promise<ClarificationDetailLoad> => {
    const now = new Date().toISOString();
    return {
      ...(await asReviewer((client, subject) =>
        loadClarificationDetail(client, data.caseId, data.clarificationId, subject, now),
      )),
      now,
    };
  });

export const resolveClarification = createServerFn({ method: 'POST' })
  .validator(z.object({ clarificationId: id, note: z.string().min(1).max(2000) }))
  .handler(({ data }): Promise<ServiceResult<Clarification>> =>
    asReviewer((client) => resolve(client, data.clarificationId, data.note)),
  );

export const withdrawClarification = createServerFn({ method: 'POST' })
  .validator(z.object({ clarificationId: id, reason: z.string().min(1).max(1000) }))
  .handler(({ data }): Promise<ServiceResult<Clarification>> =>
    asReviewer((client) => withdraw(client, data.clarificationId, data.reason)),
  );

export const raiseFollowUpClarification = createServerFn({ method: 'POST' })
  .validator(z.object({ clarificationId: id }))
  .handler(({ data }): Promise<ServiceResult<Clarification>> =>
    asReviewer((client) => raiseFollowUp(client, data.clarificationId)),
  );

export interface DownloadLink {
  downloadUrl: string;
}

/** A response attachment, through the case's audited attachment download. */
export const getResponseAttachmentLink = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id, uploadId: id }))
  .handler(({ data }): Promise<ServiceResult<DownloadLink>> =>
    asReviewer((client) =>
      callService(() =>
        client.GET('/v1/review/cases/{caseId}/attachments/{uploadId}/download', {
          params: { path: { caseId: data.caseId, uploadId: data.uploadId } },
        }),
      ),
    ),
  );

/** The clarification letter PDF from the documents service. */
export const getLetterLink = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: id }))
  .handler(({ data }): Promise<ServiceResult<DownloadLink>> =>
    asReviewer((_client, _subject, accessToken) => {
      const send = mockSend('documents');
      const documents = createDocumentsClient({
        baseUrl: env().DOCUMENTS_API_URL,
        accessToken,
        ...(send ? { fetch: send } : {}),
      });
      return callService(() =>
        documents.GET('/v1/documents/{documentId}/download', {
          params: { path: { documentId: data.documentId } },
        }),
      );
    }),
  );
