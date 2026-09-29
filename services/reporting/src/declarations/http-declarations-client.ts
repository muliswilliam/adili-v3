import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  OFFICER_DETAILS_PAGE,
  type OfficerDetails,
} from './declarations-client.js';

/** The scope the reporting service's token needs for the declarations internal API. */
export const DECLARATIONS_INTERNAL_SCOPE = 'declarations:internal';

export interface HttpDeclarationsClientOptions {
  declarationsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
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
    }),
  ),
});

/** `POST /internal/v1/obligations/details` with the reporting service's own token. */
export class HttpDeclarationsClient extends DeclarationsClient {
  private readonly api: InternalApi;

  constructor(options: HttpDeclarationsClientOptions) {
    super();
    this.api = new InternalApi({
      baseUrl: options.declarationsUrl,
      service: 'declarations',
      tokens: options.tokens,
      unavailable: (message, cause) => new DeclarationsUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? 10_000,
      fetch: options.fetch,
    });
  }

  async officerDetails(tenant: string, obligationIds: string[]): Promise<OfficerDetails[]> {
    const officers: OfficerDetails[] = [];
    for (let start = 0; start < obligationIds.length; start += OFFICER_DETAILS_PAGE) {
      const page = await this.api.post({
        path: 'internal/v1/obligations/details',
        tenant,
        body: { obligationIds: obligationIds.slice(start, start + OFFICER_DETAILS_PAGE) },
        schema: detailsSchema,
      });
      if (!page) throw new DeclarationsUnavailable('The declarations service answered 404');
      officers.push(...page.items);
    }
    return officers;
  }
}
