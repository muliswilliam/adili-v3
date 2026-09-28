import { type ServiceTokenClient, ServiceTokenError } from '@adili/api-kit';
import createClient, { type Client } from 'openapi-fetch';
import { z } from 'zod';

import type { paths } from './integration-gateway-api.gen.js';
import { type IprsPerson, IprsLookup, IprsUnavailable } from './iprs-lookup.js';

/** The scope the directory's service token needs for the IPRS lookup. */
export const IPRS_SCOPE = 'iprs';

export interface HttpIprsLookupOptions {
  /** Base URL of the integration-gateway, e.g. `http://localhost:4010`. */
  integrationGatewayUrl: string;
  /** Client credentials tokens of the directory carrying `iprs`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * Per call. The gateway gives IPRS 2 s and answers 503 itself past that; this bounds a gateway
   * that does not answer at all. Default 5 s.
   */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** What the directory reads of the gateway's `IprsPerson`, validated at the boundary. */
const iprsPersonSchema = z.object({
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
});

/**
 * IPRS through the integration-gateway's internal API (`POST /internal/v1/iprs/person-lookups`,
 * the national ID in the body so it stays out of URLs and logs), with the client generated from
 * its contract (packages/schemas/internal/integration-gateway.yaml → integration-gateway-api.gen.ts
 * via `pnpm generate:api`) and the directory's own token (client credentials, `iprs`). 200 is the
 * person, 404 no such person; anything else (503 `upstream-unavailable`, a timeout, no answer)
 * is `IprsUnavailable`.
 */
export class HttpIprsLookup extends IprsLookup {
  private readonly gateway: Client<paths>;

  constructor(private readonly options: HttpIprsLookupOptions) {
    super();
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 5_000;
    this.gateway = createClient<paths>({
      baseUrl: options.integrationGatewayUrl.replace(/\/$/, ''),
      headers: { accept: 'application/json' },
      fetch: (request) =>
        fetchImpl(new Request(request, { signal: AbortSignal.timeout(timeoutMs) })),
    });
  }

  async find(nationalId: string): Promise<IprsPerson | null> {
    let answer = await this.lookup(nationalId);
    if (answer.response.status === 401) {
      this.options.tokens.invalidate();
      answer = await this.lookup(nationalId);
    }
    const { data, response } = answer;
    if (response.status === 404) return null;
    if (!response.ok || !data) {
      throw new IprsUnavailable(`the integration-gateway answered ${String(response.status)}`);
    }
    const parsed = iprsPersonSchema.safeParse(data);
    if (!parsed.success) {
      throw new IprsUnavailable(
        'the integration-gateway answered a person that breaks its contract',
        {
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  }

  private async lookup(nationalId: string) {
    let token: string;
    try {
      token = await this.options.tokens.token();
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw new IprsUnavailable('no service token for the integration-gateway', {
          cause: error,
        });
      }
      throw error;
    }
    try {
      return await this.gateway.POST('/internal/v1/iprs/person-lookups', {
        body: { nationalId },
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      throw new IprsUnavailable('the integration-gateway is unreachable', { cause: error });
    }
  }
}
