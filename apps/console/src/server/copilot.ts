import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import { type Copilot, loadCopilot, rateOutput, refreshCopilot } from './copilot.server';
import { reviewClient, type ReviewClient } from './review/client.server';
import type { ServiceResult } from './service-call';

/**
 * Server functions for the Copilot panel on a review case (spec 07c FE-2), called as the
 * signed-in reviewer or supervisor. The review service decides who may read, refresh and rate.
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
