import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../upstream-refusal.js';
import type { paths } from './review-api.gen.js';
import {
  type ClarificationDisclosureRequest,
  type DisclosedClarification,
  ReviewClient,
  ReviewUnavailable,
} from './review-client.js';

export interface HttpReviewClientOptions {
  reviewUrl: string;
  /** Tokens with `review:disclosures`, which only the access service's token holds. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default ADR-013's 2 s. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** The fields of `ClarificationDisclosure` the access service relies on; the rest passes through. */
const disclosureSchema = z.object({
  grantReference: z.string(),
  clarifications: z.array(
    z.looseObject({ declarationReference: z.string(), reference: z.string() }),
  ),
});

/**
 * Review's `internalDiscloseClarifications` through the client generated from its contract
 * (packages/schemas/internal/review.yaml → review-api.gen.ts via `pnpm generate:api`), with the
 * access service's own token (`review:disclosures`), the Commission in `X-Acting-Tenant` and the
 * deciding officer in `X-Acting-Subject`, whom review audits the read for; the recipient goes in
 * the body.
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

  async discloseClarifications(
    request: ClarificationDisclosureRequest,
  ): Promise<DisclosedClarification[]> {
    const { tenant, officerSubject, ...body } = request;
    const disclosure = await this.review.call(
      (api) =>
        api.POST('/internal/v1/review/clarifications/disclosures', {
          params: { header: { 'X-Acting-Tenant': tenant, 'X-Acting-Subject': officerSubject } },
          body,
        }),
      {
        status: 200,
        schema: disclosureSchema,
        otherwise: refusedWith('review', [400, 403]),
      },
    );
    return disclosure.clarifications as DisclosedClarification[];
  }
}
