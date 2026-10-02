import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import {
  type ClarificationDetail,
  loadClarificationDetail,
  raiseFollowUp,
  resolve,
  withdraw,
} from './clarifications.server';
import { reviewClient, type ReviewClient } from './review/client.server';
import type { Clarification } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * Server functions for a clarification on a review case (spec 07a FE-4, S15), called as the
 * signed-in reviewer or supervisor. Tokens stay on the server; downloads come back as
 * short-lived links.
 */

async function asReviewer<T>(
  work: (client: ReviewClient, subject: string, accessToken: string) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
  return work(reviewClient(session.accessToken), session.user.subject, session.accessToken);
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

/**
 * The clarification letter PDF, through the review service's audited letter download (which
 * asks the documents service for the Commission). Any review staff who can see the case.
 */
export const getLetterLink = createServerFn({ method: 'GET' })
  .validator(z.object({ clarificationId: id }))
  .handler(({ data }): Promise<ServiceResult<DownloadLink>> =>
    asReviewer((client) =>
      callService(() =>
        client.GET('/v1/review/clarifications/{clarificationId}/letter/download', {
          params: { path: { clarificationId: data.clarificationId } },
        }),
      ),
    ),
  );
