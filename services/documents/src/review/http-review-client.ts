import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './review-api.gen.js';
import { ClarificationNotFound, ReviewClient, ReviewUnavailable } from './review-client.js';

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
 * The review internal API through the client generated from its contract
 * (packages/schemas/internal/review.yaml → review-api.gen.ts via `pnpm generate:api`) on
 * api-kit's service client: the service's own token (client credentials, `review:internal`), the
 * Commission in `X-Acting-Tenant` (review answers 404 for another Commission's clarification).
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
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
  }

  clarificationLetterPayload(tenant: string, clarificationId: string): Promise<unknown> {
    return this.review.call(
      (api) =>
        api.GET('/internal/v1/review/clarifications/{clarificationId}/letter-payload', {
          params: { path: { clarificationId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      {
        status: 200,
        schema: payloadSchema,
        otherwise: {
          404: (): never => {
            throw new ClarificationNotFound(clarificationId);
          },
        },
      },
    );
  }
}
