import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { asReviewer } from './as-viewer.server';
import { getBff } from './bff.server';
import {
  type ClarificationDetail,
  type IssueResult,
  issueDraft,
  loadClarificationDetail,
  raiseFollowUp,
  resolve,
  saveDraft,
  withdraw,
} from './clarifications.server';
import { documentsClient } from './documents/client.server';
import { reviewClient } from './review/client.server';
import type { Clarification } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * Server functions for a clarification on a review case (spec 07a FE-4, S15), called as the
 * signed-in reviewer or supervisor. Tokens stay on the server; downloads come back as
 * short-lived links.
 */

const id = z.uuid();

export type ClarificationDetailLoad = ServiceResult<ClarificationDetail> & { now: string };

export const getClarificationDetail = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id, clarificationId: id }))
  .handler(async ({ data }): Promise<ClarificationDetailLoad> => {
    const now = new Date().toISOString();
    return {
      ...(await asReviewer((client, { subject }) =>
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

/** review.yaml `ClarificationItemInput`, as the composer sends it. */
const item = z.object({
  sectionKey: z.string().nullable(),
  personKey: z.string().nullable(),
  itemId: z.uuid().nullable(),
  requirement: z.enum(['provide-omitted', 'explain-discrepancy', 'correct']),
  text: z.string().trim().min(1).max(1000),
  /** The Draft with AI job that drafted it; null for the reviewer's own (ADR-007 label). */
  aiJobId: z.uuid().nullable(),
});

const composed = z.object({
  caseId: id,
  /** The draft being edited, or null for a new one. */
  clarificationId: id.nullable(),
  items: z.array(item).max(50),
  /** The letter's opening paragraph (Draft with AI's), or null for none. */
  opening: z.string().max(800).nullable(),
  /** The Draft with AI job that drafted the opening paragraph, or null. */
  openingAiJobId: z.uuid().nullable(),
  /** One per composer, reused on retry, so a retried create makes one draft. */
  draftKey: id,
});

/** Saves the composer's items as a draft (spec 07a FE-4); the declarant does not see it. */
export const saveClarificationDraft = createServerFn({ method: 'POST' })
  .validator(composed)
  .handler(({ data }): Promise<ServiceResult<Clarification>> =>
    asReviewer((client) =>
      saveDraft(
        client,
        data.caseId,
        data.clarificationId,
        { items: data.items, opening: data.opening, openingAiJobId: data.openingAiJobId },
        data.draftKey,
      ),
    ),
  );

/**
 * Saves and issues the composer's clarification (S12): the CLR reference, the letter, the
 * declarant's notices and the 30-day clock. On failure the saved draft's id comes back.
 */
export const issueComposedClarification = createServerFn({ method: 'POST' })
  .validator(composed.extend({ issueKey: id }))
  .handler(async ({ data }): Promise<IssueResult> => {
    const session = await getBff().getSession(getRequest());
    if (!session) return { ok: false, error: { kind: 'unauthenticated' }, draftId: null };
    return issueDraft(
      reviewClient(session.accessToken),
      data.caseId,
      data.clarificationId,
      { items: data.items, opening: data.opening, openingAiJobId: data.openingAiJobId },
      { draft: data.draftKey, issue: data.issueKey },
    );
  });

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
    asReviewer((_client, { accessToken }) =>
      callService(() =>
        documentsClient(accessToken).GET('/v1/documents/{documentId}/download', {
          params: { path: { documentId: data.documentId } },
        }),
      ),
    ),
  );
