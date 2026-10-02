import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { queueQuery, queueSearchSchema } from '../review-queue/query';
import type { QueueSummary } from '../review-queue/rows';
import { asOfficer } from './review/as-officer.server';
import type { CaseListItem } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * Server functions for the review queue (spec 07a FE-2), called as the signed-in reviewer or
 * supervisor. The review service answers 404 to anyone else, and for another Commission's slug.
 */

const slug = z.string().regex(/^[a-z][a-z0-9]{1,19}$/);

export interface QueuePage {
  items: CaseListItem[];
  nextCursor: string | null;
}

/** `GET /v1/commissions/{slug}/review/queue`: a page of cases for the filters, by score then age. */
export const getReviewQueue = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug,
      filters: queueSearchSchema,
      cursor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  )
  .handler(({ data }): Promise<ServiceResult<QueuePage>> =>
    asOfficer((client) =>
      callService(() =>
        client.GET('/v1/commissions/{slug}/review/queue', {
          params: {
            path: { slug: data.slug },
            query: queueQuery(data.filters, { cursor: data.cursor, limit: data.limit }),
          },
        }),
      ),
    ),
  );

/** `GET .../review/queue/summary`: the counts behind the tiles. */
export const getReviewQueueSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ slug }))
  .handler(({ data }): Promise<ServiceResult<QueueSummary>> =>
    asOfficer((client) =>
      callService(() =>
        client.GET('/v1/commissions/{slug}/review/queue/summary', {
          params: { path: { slug: data.slug } },
        }),
      ),
    ),
  );
