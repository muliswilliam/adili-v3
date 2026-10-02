import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import {
  addNote,
  attachmentLink,
  type CaseFlag,
  type CaseView,
  claim,
  loadCaseView,
  markFlagReviewed,
  reassign,
  release,
} from './review-case.server';
import { reviewClient, type ReviewClient } from './review/client.server';
import type { Assignee, CaseListItem, Note } from './review/types';
import type { ServiceResult } from './service-call';

/**
 * Server functions for the case view (spec 07a FE-3), called as the signed-in reviewer or
 * supervisor. The review service decides who may claim, release, reassign and mark flags
 * reviewed; tokens stay on the server, and attachments come back as short-lived links.
 */

async function asReviewer<T>(
  work: (client: ReviewClient, viewer: Assignee) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
  return work(reviewClient(session.accessToken), {
    subject: session.user.subject,
    name: session.user.name,
  });
}

const id = z.uuid();
const caseInput = z.object({ caseId: id });

export type CaseViewLoad = ServiceResult<CaseView> & { now: string };

export const getCaseView = createServerFn({ method: 'GET' })
  .validator(caseInput)
  .handler(async ({ data }): Promise<CaseViewLoad> => {
    const now = new Date().toISOString();
    return {
      ...(await asReviewer((client, viewer) => loadCaseView(client, data.caseId, viewer))),
      now,
    };
  });

export const claimCase = createServerFn({ method: 'POST' })
  .validator(caseInput)
  .handler(({ data }): Promise<ServiceResult<CaseListItem>> =>
    asReviewer((client) => claim(client, data.caseId)),
  );

export const releaseCase = createServerFn({ method: 'POST' })
  .validator(caseInput)
  .handler(({ data }): Promise<ServiceResult<CaseListItem>> =>
    asReviewer((client) => release(client, data.caseId)),
  );

export const reassignCase = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, assignee: z.string().min(1).max(200).nullable() }))
  .handler(({ data }): Promise<ServiceResult<CaseListItem>> =>
    asReviewer((client) => reassign(client, data.caseId, data.assignee)),
  );

export const addCaseNote = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, text: z.string().trim().min(1).max(2000) }))
  .handler(({ data }): Promise<ServiceResult<Note>> =>
    asReviewer((client) => addNote(client, data.caseId, data.text)),
  );

export const markCaseFlagReviewed = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, flagId: id, note: z.string().trim().min(1).max(1000) }))
  .handler(({ data }): Promise<ServiceResult<CaseFlag>> =>
    asReviewer((client) => markFlagReviewed(client, data.caseId, data.flagId, data.note)),
  );

export const getCaseAttachmentLink = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id, uploadId: id }))
  .handler(({ data }): Promise<ServiceResult<{ downloadUrl: string; expiresAt: string }>> =>
    asReviewer((client) => attachmentLink(client, data.caseId, data.uploadId)),
  );
