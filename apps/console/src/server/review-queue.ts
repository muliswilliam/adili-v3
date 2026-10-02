import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { queueSearchSchema } from '../review-queue/query';
import type { QueueSummary } from '../review-queue/rows';
import { SLUG_PATTERN } from './directory/contract';
import { loadQueuePage, type QueuePage } from './review-queue.server';
import { asStaffMember } from './review/as-staff-member.server';
import { callService, type ServiceResult } from './service-call';

export type { QueuePage };

/**
 * Server functions for the review queue (spec 07a FE-2), called as the signed-in reviewer or
 * supervisor. The review service answers 404 to anyone else, and for another Commission's slug.
 */

const slug = z.string().regex(SLUG_PATTERN);

/**
 * A page of the queue for the filters (`loadQueuePage`). POST to the console's server and on to
 * the review service, so the search text (a name, say) is never in a URL on either hop.
 */
export const getReviewQueue = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      slug,
      filters: queueSearchSchema,
      cursor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  )
  .handler(({ data }): Promise<ServiceResult<QueuePage>> =>
    asStaffMember((client) =>
      loadQueuePage(client, data.slug, data.filters, { cursor: data.cursor, limit: data.limit }),
    ),
  );

/** `GET .../review/queue/summary`: the counts behind the tiles. */
export const getReviewQueueSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ slug }))
  .handler(({ data }): Promise<ServiceResult<QueueSummary>> =>
    asStaffMember((client) =>
      callService(() =>
        client.GET('/v1/commissions/{slug}/review/queue/summary', {
          params: { path: { slug: data.slug } },
        }),
      ),
    ),
  );
