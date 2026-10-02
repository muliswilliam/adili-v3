import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './review-api.gen.js';
import {
  ReviewClient,
  type ReviewRecord,
  ReviewRecordNotFound,
  ReviewUnavailable,
} from './review-client.js';

export interface HttpReviewClientOptions {
  /** Base URL of the review service, e.g. `http://localhost:4003`. */
  reviewUrl: string;
  /** Client credentials tokens of the documents service carrying `review:internal`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default ADR-013's 2 s. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * A JSON object: the template validates the fields themselves, so a payload it refuses is a
 * refused issue request (400), not an outage the caller would retry.
 */
const payloadSchema = z.record(z.string(), z.unknown());

/**
 * A referral's package payload carries the evidence the review service pulls from declarations
 * and documents as it answers (spec 08), so it gets a longer budget than a letter's fields. The
 * issue request it serves runs in a review workflow activity, which retries; recorded with
 * ADR-013 §2 (synchronous budgets) like the review service's own issue timeout.
 */
export const PACKAGE_PULL_TIMEOUT_MS = 15_000;

/**
 * The review internal API through the client generated from its contract
 * (packages/schemas/internal/review.yaml → review-api.gen.ts via `pnpm generate:api`) on
 * api-kit's service client: the service's own token (client credentials, `review:internal`), the
 * Commission in `X-Acting-Tenant` (review answers 404 for another Commission's record).
 */
export class HttpReviewClient extends ReviewClient {
  private readonly review: ServiceClient<paths>;
  private readonly packages: ServiceClient<paths>;

  constructor(options: HttpReviewClientOptions) {
    super();
    const client = (timeoutMs: number | undefined) =>
      createServiceClient<paths>({
        baseUrl: options.reviewUrl,
        service: 'review',
        tokens: options.tokens,
        unavailable: (message, cause) => new ReviewUnavailable(message, cause),
        timeoutMs,
        fetch: options.fetch,
      });
    this.review = client(options.timeoutMs);
    this.packages = client(options.timeoutMs ?? PACKAGE_PULL_TIMEOUT_MS);
  }

  payload(record: ReviewRecord, tenant: string, id: string): Promise<unknown> {
    const header = { 'X-Acting-Tenant': tenant };
    const options = {
      status: 200 as const,
      schema: payloadSchema,
      otherwise: {
        404: (): never => {
          throw new ReviewRecordNotFound(record, id);
        },
      },
    };
    switch (record) {
      case 'clarification':
        return this.review.call(
          (api) =>
            api.GET('/internal/v1/review/clarifications/{clarificationId}/letter-payload', {
              params: { path: { clarificationId: id }, header },
            }),
          options,
        );
      case 'determination':
        return this.review.call(
          (api) =>
            api.GET('/internal/v1/review/determinations/{determinationId}/letter-payload', {
              params: { path: { determinationId: id }, header },
            }),
          options,
        );
      case 'action':
        return this.review.call(
          (api) =>
            api.GET('/internal/v1/review/actions/{actionId}/letter-payload', {
              params: { path: { actionId: id }, header },
            }),
          options,
        );
      case 'referral':
        return this.packages.call(
          (api) =>
            api.GET('/internal/v1/review/referrals/{referralId}/package-payload', {
              params: { path: { referralId: id }, header },
            }),
          options,
        );
    }
  }
}
