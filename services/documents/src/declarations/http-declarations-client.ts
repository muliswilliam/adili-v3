import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { acknowledgementSlipPayload } from '../issuance/templates/acknowledgement-slip.v1.js';
import type { paths } from './declarations-api.gen.js';
import {
  type AcknowledgementPayload,
  DeclarationsClient,
  DeclarationsUnavailable,
  VersionNotFound,
} from './declarations-client.js';

export interface HttpDeclarationsClientOptions {
  /** Base URL of the declarations service, e.g. `http://localhost:4002`. */
  declarationsUrl: string;
  /** Client credentials tokens of the documents service carrying `declarations:internal`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default ADR-013's 2 s. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** The answer, validated at the boundary: the slip against the template's own payload schema. */
const payloadSchema = z.object({
  declarantPersonId: z.uuid(),
  slip: acknowledgementSlipPayload,
});

/**
 * The declarations internal API through the client generated from its contract
 * (packages/schemas/internal/declarations.yaml → declarations-api.gen.ts via `pnpm
 * generate:api`) on api-kit's service client: the service's own token (client credentials,
 * `declarations:internal`), the Commission in `X-Acting-Tenant` (declarations answers 404 for
 * another Commission's version), answers validated at the boundary.
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
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
  }

  acknowledgementPayload(
    tenant: string,
    declarationId: string,
    version: number,
  ): Promise<AcknowledgementPayload> {
    return this.declarations.call(
      (api) =>
        api.GET(
          '/internal/v1/declarations/{declarationId}/versions/{version}/acknowledgement-payload',
          {
            params: {
              path: { declarationId, version },
              header: { 'X-Acting-Tenant': tenant },
            },
          },
        ),
      {
        status: 200,
        schema: payloadSchema,
        otherwise: {
          404: (): never => {
            throw new VersionNotFound(declarationId, version);
          },
        },
      },
    );
  }
}
