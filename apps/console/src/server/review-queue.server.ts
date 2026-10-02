import { type QueueSearch, queueSearchBody } from '../review-queue/query';
import type { ReviewClient } from './review/client.server';
import type { CaseListItem } from './review/types';
import { callService, type ServiceResult } from './service-call';

export interface QueuePage {
  items: CaseListItem[];
  nextCursor: string | null;
}

/**
 * `POST /v1/commissions/{slug}/review/queue/search`: a page of cases for the filters, by score
 * then age. The filters and search text go in the body, so a name typed in the search is never
 * in a URL the review service, a proxy in front of it or a trace of the call records. Pure: the
 * caller injects the client (`review-queue.ts` calls it as the signed-in staff member).
 */
export function loadQueuePage(
  client: ReviewClient,
  slug: string,
  filters: QueueSearch,
  page: { cursor?: string; limit?: number } = {},
): Promise<ServiceResult<QueuePage>> {
  return callService(() =>
    client.POST('/v1/commissions/{slug}/review/queue/search', {
      params: { path: { slug } },
      body: queueSearchBody(filters, page),
    }),
  );
}
