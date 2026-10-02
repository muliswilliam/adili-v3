import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import { commissionSlug } from './commission-slug';
import type { paths } from './review/api.gen';
import { reviewClient } from './review/client.server';
import { callService, type ServiceResult } from './service-call';

/** Whether AI assistance is enabled for a Commission, and with which provider class. */
export type CommissionAiStatus =
  paths['/v1/commissions/{slug}/ai-status']['get']['responses']['200']['content']['application/json'];

/**
 * `GET /v1/commissions/{slug}/ai-status` on the review service (spec 07c FE-4): the Commission's
 * own commission admin only (the spec's role table); 404 for anyone else, supervisors included,
 * and for another Commission.
 */
export const getCommissionAiStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(async ({ data }): Promise<ServiceResult<CommissionAiStatus>> => {
    const session = await getBff().getSession(getRequest());
    if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
    const client = reviewClient(session.accessToken);
    return callService(() =>
      client.GET('/v1/commissions/{slug}/ai-status', { params: { path: { slug: data.slug } } }),
    );
  });
