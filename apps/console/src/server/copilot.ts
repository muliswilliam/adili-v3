import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import { type AiDraft, pollDraft, requestDraft } from './copilot-drafts.server';
import { type Copilot, loadCopilot, rateOutput, refreshCopilot } from './copilot.server';
import { reviewClient, type ReviewClient } from './review/client.server';
import type { ServiceResult } from './service-call';

/**
 * Server functions for the Copilot panel on a review case (spec 07c FE-2) and Draft with AI in
 * the clarification composer (FE-3), called as the signed-in reviewer or supervisor. The review
 * service decides who may read, refresh, rate and draft.
 */

async function asReviewer<T>(
  work: (client: ReviewClient) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
  return work(reviewClient(session.accessToken));
}

const caseInput = z.object({ caseId: z.uuid() });

export const getCaseCopilot = createServerFn({ method: 'GET' })
  .validator(caseInput)
  .handler(({ data }): Promise<ServiceResult<Copilot>> =>
    asReviewer((client) => loadCopilot(client, data.caseId)),
  );

export const refreshCaseCopilot = createServerFn({ method: 'POST' })
  .validator(caseInput)
  .handler(({ data }): Promise<ServiceResult<Copilot>> =>
    asReviewer((client) => refreshCopilot(client, data.caseId)),
  );

export const rateCopilotOutput = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      jobId: z.uuid(),
      rating: z.enum(['helpful', 'not-helpful']),
      reason: z.enum(['inaccurate', 'missed-something', 'unclear', 'too-long', 'other']).nullable(),
      note: z.string().max(1000).nullable(),
    }),
  )
  .handler(({ data: { jobId, ...feedback } }): Promise<ServiceResult<null>> =>
    asReviewer((client) => rateOutput(client, jobId, feedback)),
  );

const nullable = z.string().max(100).nullable();

/** Draft with AI: items for the picked flags and items, in the language asked for. */
export const draftClarificationWithAi = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      caseId: z.uuid(),
      key: z.uuid(),
      flagIds: z.array(z.uuid()).max(50),
      itemRefs: z
        .array(
          z.object({
            sectionKey: nullable,
            personKey: nullable,
            itemId: z.uuid().nullable(),
            requirement: z.enum(['provide-omitted', 'explain-discrepancy', 'correct']).nullable(),
          }),
        )
        .max(50),
      language: z.enum(['en', 'sw']),
    }),
  )
  .handler(({ data: { caseId, key, ...input } }): Promise<ServiceResult<AiDraft>> =>
    asReviewer((client) => requestDraft(client, caseId, input, key)),
  );

/** Polls a pending draft. */
export const getCopilotDraft = createServerFn({ method: 'GET' })
  .validator(z.object({ draftId: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<AiDraft>> =>
    asReviewer((client) => pollDraft(client, data.draftId)),
  );
