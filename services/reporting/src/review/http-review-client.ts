import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './review-api.gen.js';
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

/**
 * How long a review read may take: a page of details is up to 1,000 clarifications. Recorded in
 * ADR-013 §2; reads run in workflow activities, which retry, or behind an analyst's push.
 */
export const REVIEW_READ_TIMEOUT_MS = 10_000;

export interface HttpReviewClientOptions {
  reviewUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default `REVIEW_READ_TIMEOUT_MS`. */
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
    }) satisfies z.ZodType<ClarificationDetails>,
  ),
});

const icmsPayloadSchema = z.object({
  reference: z.string().min(1),
  grounds: z.string().min(1),
  groundsLabel: z.string().min(1),
  commission: z.object({ name: z.string().min(1), issuerCode: z.string().min(1) }),
  declarant: z.object({ name: z.string().min(1), nationalId: z.string().min(1) }),
  narrative: z.string(),
}) satisfies z.ZodType<ReferralIcmsPayload>;

/**
 * Review's `internalClarificationDetails` and `internalGetReferralIcmsPayload` through the client
 * generated from its contract (packages/schemas/internal/review.yaml → review-api.gen.ts via
 * `pnpm generate:api`), with the reporting service's own token, acting for the Commission in
 * `X-Acting-Tenant` (ADR-013 §8.6).
 */
export class HttpReviewClient extends ReviewClient {
  private readonly review: ServiceClient<paths>;

  constructor(options: HttpReviewClientOptions) {
    super();
    this.review = createServiceClient<paths>({
      baseUrl: options.reviewUrl,
      service: 'review',
      tokens: options.tokens,
      unavailable: (message, cause) => new ReviewUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? REVIEW_READ_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  async clarificationDetails(
    tenant: string,
    clarificationIds: string[],
  ): Promise<ClarificationDetails[]> {
    const found: ClarificationDetails[] = [];
    for (let start = 0; start < clarificationIds.length; start += CLARIFICATION_DETAILS_PAGE) {
      const page = await this.review.call(
        (api) =>
          api.POST('/internal/v1/review/clarifications/details', {
            params: { header: { 'X-Acting-Tenant': tenant } },
            body: {
              clarificationIds: clarificationIds.slice(start, start + CLARIFICATION_DETAILS_PAGE),
            },
          }),
        { status: 200, schema: detailsSchema, otherwise: refusedWith('review', [400, 403]) },
      );
      found.push(...page.items);
    }
    return found;
  }

  referralIcmsPayload(
    tenant: string,
    referralId: string,
    actingSubject: string,
  ): Promise<ReferralIcmsPayload | null> {
    return this.review.call(
      (api) =>
        api.GET('/internal/v1/review/referrals/{referralId}/icms-payload', {
          params: {
            path: { referralId },
            header: { 'X-Acting-Tenant': tenant, 'X-Acting-Subject': actingSubject },
          },
        }),
      {
        status: 200,
        schema: icmsPayloadSchema,
        otherwise: { 404: () => null, ...refusedWith('review', [409]) },
      },
    );
  }
}
