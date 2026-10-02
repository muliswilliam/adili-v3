import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import type { DownloadLink } from './clarifications';
import {
  addNote,
  type CaseFlag,
  type CaseLoad,
  type CaseRegistryView,
  claim,
  loadCase,
  loadOfficers,
  markFlagReviewed,
  loadRegistry,
  loadRegistryStatus,
  type Officer,
  reassign,
  recheck,
  type RecheckResult,
  release,
} from './review-case.server';
import { asOfficer } from './review/as-officer.server';
import { reviewClient } from './review/client.server';
import type { CaseListItem, Note } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * Server functions for the case view (spec 07a FE-3), called as the signed-in reviewer or
 * supervisor. Tokens stay on the server; attachments come back as short-lived links.
 */

const id = z.uuid();

export type CaseViewLoad = ServiceResult<CaseLoad> & {
  /** The viewer's subject, to tell whether they hold the case. */
  subject: string | null;
  now: string;
};

export const getCaseView = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id }))
  .handler(async ({ data }): Promise<CaseViewLoad> => {
    const now = new Date().toISOString();
    let subject: string | null = null;
    const result = await asOfficer((client, user) => {
      subject = user.subject;
      return loadCase(client, data.caseId);
    });
    return { ...result, subject, now };
  });

export const claimCase = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id }))
  .handler(({ data }): Promise<ServiceResult<CaseListItem>> =>
    asOfficer((client) => claim(client, data.caseId)),
  );

export const releaseCase = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id }))
  .handler(({ data }): Promise<ServiceResult<CaseListItem>> =>
    asOfficer((client) => release(client, data.caseId)),
  );

export const reassignCase = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, assignee: z.string().min(1).max(200).nullable() }))
  .handler(({ data }): Promise<ServiceResult<CaseListItem>> =>
    asOfficer((client) => reassign(client, data.caseId, data.assignee)),
  );

export const addCaseNote = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, text: z.string().trim().min(1).max(2000) }))
  .handler(({ data }): Promise<ServiceResult<Note>> =>
    asOfficer((client) => addNote(client, data.caseId, data.text)),
  );

export const markCaseFlagReviewed = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, flagId: id, note: z.string().trim().min(1).max(1000) }))
  .handler(({ data }): Promise<ServiceResult<CaseFlag>> =>
    asOfficer((client) => markFlagReviewed(client, data.caseId, data.flagId, data.note)),
  );

const officer = z.object({ subject: z.string().min(1).max(200), name: z.string().max(200) });

/**
 * The officers a supervisor can give the case to (see `loadOfficers`). The page passes the
 * holder and the reviewers of record it already has, for the labels only: the reassignment
 * itself is checked by the review service.
 */
export const getReassignOfficers = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug: z.string().regex(/^[a-z][a-z0-9]{1,19}$/),
      assignee: z.string().min(1).max(200).nullable(),
      reviewerHistory: z.array(officer).max(100),
    }),
  )
  .handler(({ data }): Promise<ServiceResult<Officer[]>> =>
    asOfficer((client, user) =>
      loadOfficers(
        client,
        data.slug,
        { assignee: data.assignee, reviewerHistory: data.reviewerHistory },
        user,
      ),
    ),
  );

/** An attachment of the version under review, through the case's audited download. */
export const getCaseAttachmentLink = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id, uploadId: id }))
  .handler(({ data }): Promise<ServiceResult<DownloadLink>> =>
    asOfficer((client) =>
      callService(() =>
        client.GET('/v1/review/cases/{caseId}/attachments/{uploadId}/download', {
          params: { path: { caseId: data.caseId, uploadId: data.uploadId } },
        }),
      ),
    ),
  );

/**
 * The Registry tab's records (spec 07b): an audited read of the declaration and the registry
 * records, so the tab reads it when opened, not with every load of the case.
 */
export const getCaseRegistry = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id }))
  .handler(({ data }): Promise<ServiceResult<CaseRegistryView>> =>
    asOfficer((client) => loadRegistry(client, data.caseId)),
  );

/** When the case's latest registry check was stored: polled while a re-check runs, unaudited. */
export const getCaseRegistryStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ caseId: id }))
  .handler(({ data }): Promise<ServiceResult<{ checkedAt: string | null }>> =>
    asOfficer((client) => loadRegistryStatus(client, data.caseId)),
  );

/** Re-checks the case's registries: the assignee or a supervisor, once every 10 minutes. */
export const recheckCaseRegistries = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id }))
  .handler(async ({ data }): Promise<RecheckResult> => {
    const session = await getBff().getSession(getRequest());
    if (!session) return { ok: false, refusal: null, error: { kind: 'unauthenticated' } };
    return recheck(reviewClient(session.accessToken), data.caseId);
  });
