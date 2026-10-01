import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './declarations-api.gen.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  OFFICER_DETAILS_PAGE,
  type OfficerDetails,
} from './declarations-client.js';

/** The scope the reporting service's token needs for the declarations internal API. */
export const DECLARATIONS_INTERNAL_SCOPE = 'declarations:internal';

/**
 * How long a page of details may take: up to 1,000 obligations. Recorded in ADR-013 §2; pulls
 * run in workflow activities, which retry.
 */
export const DECLARATIONS_DETAILS_TIMEOUT_MS = 10_000;

export interface HttpDeclarationsClientOptions {
  declarationsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default `DECLARATIONS_DETAILS_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const detailsSchema = z.object({
  items: z.array(
    z.object({
      obligationId: z.uuid(),
      name: z.string(),
      designation: z.string(),
      fileNumber: z.string(),
      appointmentDate: z.iso.date().nullable(),
      exitDate: z.iso.date().nullable(),
    }) satisfies z.ZodType<OfficerDetails>,
  ),
});

/**
 * Declarations' `internalObligationDetails` through the client generated from its contract
 * (packages/schemas/internal/declarations.yaml → declarations-api.gen.ts via
 * `pnpm generate:api`), with the reporting service's own token, acting for the Commission in
 * `X-Acting-Tenant` (ADR-013 §8.6).
 */
export class HttpDeclarationsClient extends DeclarationsClient {
  private readonly declarations: ServiceClient<paths>;

  constructor(options: HttpDeclarationsClientOptions) {
    super();
    this.declarations = createServiceClient<paths>({
      baseUrl: options.declarationsUrl,
      service: 'declarations',
      tokens: options.tokens,
      unavailable: (message, cause) => new DeclarationsUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? DECLARATIONS_DETAILS_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  async officerDetails(tenant: string, obligationIds: string[]): Promise<OfficerDetails[]> {
    const officers: OfficerDetails[] = [];
    for (let start = 0; start < obligationIds.length; start += OFFICER_DETAILS_PAGE) {
      const page = await this.declarations.call(
        (api) =>
          api.POST('/internal/v1/obligations/details', {
            params: { header: { 'X-Acting-Tenant': tenant } },
            body: { obligationIds: obligationIds.slice(start, start + OFFICER_DETAILS_PAGE) },
          }),
        { status: 200, schema: detailsSchema, otherwise: refusedWith('declarations', [400, 403]) },
      );
      officers.push(...page.items);
    }
    return officers;
  }
}
