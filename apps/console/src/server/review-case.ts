import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asReviewer, withReviewer } from './as-viewer.server';
import { SLUG_PATTERN } from './directory/contract';
import {
  addNote,
  attachmentLink,
  type CaseFlag,
  type CaseRegistryView,
  type CaseView,
  claim,
  loadCaseView,
  loadRegistry,
  loadRegistryStatus,
  loadReviewers,
  markFlagReviewed,
  reassign,
  recheck,
  type RecheckResult,
  release,
  type Reviewer,
} from './review-case.server';
import type { CaseListItem, Note } from './review/types';
import type { ServiceResult } from './service-call';

/**
 * Server functions for the case view (spec 07a FE-3), called as the signed-in reviewer or
 * supervisor. The review service decides who may claim, release, reassign and mark flags
 * reviewed; tokens stay on the server, and attachments come back as short-lived links.
 */

const id = z.uuid();
const caseInput = z.object({ caseId: id });

export type CaseViewLoad = ServiceResult<CaseView> & { now: string };

export const getCaseView = createServerFn({ method: 'GET' })
  .validator(caseInput)
  .handler(async ({ data }): Promise<CaseViewLoad> => {
    const now = new Date().toISOString();
    return {
      ...(await asReviewer((client, { subject, name }) =>
        loadCaseView(client, data.caseId, { subject, name }),
      )),
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

const staffMember = z.object({ subject: z.string().min(1).max(200), name: z.string().max(200) });

/**
 * The reviewers a supervisor can give the case to, or filter the queue by (see `loadReviewers`).
 * The page passes the holder and the reviewers of record it already has, for the labels only:
 * the reassignment itself is checked by the review service.
 */
export const getReviewers = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug: z.string().regex(SLUG_PATTERN),
      assignee: z.string().min(1).max(200).nullable(),
      reviewerHistory: z.array(staffMember).max(100),
    }),
  )
  .handler(({ data }): Promise<ServiceResult<Reviewer[]>> =>
    asReviewer((client) =>
      loadReviewers(client, data.slug, {
        assignee: data.assignee,
        reviewerHistory: data.reviewerHistory,
      }),
    ),
  );

/**
 * The Registry tab's records (spec 07b): an audited read of the declaration and the registry
 * records, so the tab reads it when opened, not with every load of the case.
 */
export const getCaseRegistry = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id }))
  .handler(({ data }): Promise<ServiceResult<CaseRegistryView>> =>
    asReviewer((client) => loadRegistry(client, data.caseId)),
  );

/** When the case's latest registry check was stored: polled while a re-check runs, unaudited. */
export const getCaseRegistryStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id }))
  .handler(({ data }): Promise<ServiceResult<{ checkedAt: string | null }>> =>
    asReviewer((client) => loadRegistryStatus(client, data.caseId)),
  );

/** Re-checks the case's registries: the assignee or a supervisor, once every 10 minutes. */
export const recheckCaseRegistries = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id }))
  .handler(({ data }): Promise<RecheckResult> =>
    withReviewer(
      (client) => recheck(client, data.caseId),
      () => ({ ok: false, refusal: null, error: { kind: 'unauthenticated' } }),
    ),
  );
