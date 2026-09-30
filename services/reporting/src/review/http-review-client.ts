import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  type ClarificationDetails,
  type ReferralIcmsPayload,
  ReviewClient,
  ReviewUnavailable,
} from './review-client.js';

/** The scope the reporting service's token needs for the review internal API. */
export const REVIEW_INTERNAL_SCOPE = 'review:internal';

/** The most clarification ids one details request carries. */
export const CLARIFICATION_DETAILS_PAGE = 1_000;

export interface HttpReviewClientOptions {
  reviewUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const detailsSchema = z.object({
  items: z.array(
    z.object({
      clarificationId: z.uuid(),
      reference: z.string().nullable(),
      name: z.string(),
      designation: z.string(),
      identifier: z.string(),
      requirementLabels: z.array(z.string()),
    }),
  ),
});

const icmsPayloadSchema = z.object({
  reference: z.string().min(1),
  grounds: z.string().min(1),
  groundsLabel: z.string().min(1),
  commission: z.object({ name: z.string().min(1), issuerCode: z.string().min(1) }),
  declarant: z.object({ name: z.string().min(1), nationalId: z.string().min(1) }),
  narrative: z.string(),
});

/**
 * `POST /internal/v1/review/clarifications/details` and
 * `GET /internal/v1/review/referrals/{referralId}/icms-payload` with the reporting service's own
 * token.
 */
export class HttpReviewClient extends ReviewClient {
  private readonly api: InternalApi;

  constructor(options: HttpReviewClientOptions) {
    super();
    this.api = new InternalApi({
      baseUrl: options.reviewUrl,
      service: 'review',
      tokens: options.tokens,
      unavailable: (message, cause) => new ReviewUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? 10_000,
      fetch: options.fetch,
    });
  }

  async clarificationDetails(
    tenant: string,
    clarificationIds: string[],
  ): Promise<ClarificationDetails[]> {
    const found: ClarificationDetails[] = [];
    for (let start = 0; start < clarificationIds.length; start += CLARIFICATION_DETAILS_PAGE) {
      const page = await this.api.post({
        path: 'internal/v1/review/clarifications/details',
        tenant,
        body: {
          clarificationIds: clarificationIds.slice(start, start + CLARIFICATION_DETAILS_PAGE),
        },
        schema: detailsSchema,
      });
      if (!page) throw new ReviewUnavailable('The review service answered 404');
      found.push(...page.items);
    }
    return found;
  }

  referralIcmsPayload(
    tenant: string,
    referralId: string,
    actingSubject: string,
  ): Promise<ReferralIcmsPayload | null> {
    return this.api.get({
      path: `internal/v1/review/referrals/${encodeURIComponent(referralId)}/icms-payload`,
      tenant,
      headers: { 'x-acting-subject': actingSubject },
      schema: icmsPayloadSchema,
    });
  }
}
