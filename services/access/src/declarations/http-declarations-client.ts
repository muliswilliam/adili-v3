import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './declarations-api.gen.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type DisclosureDocument,
  type DisclosureRequest,
  type VersionDocument,
} from './declarations-client.js';

export interface HttpDeclarationsClientOptions {
  declarationsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default ADR-013's 2 s. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** The fields of `DisclosureDocument` the access service relies on; the rest passes through. */
const disclosureSchema = z.looseObject({
  schemaVersion: z.literal('disclosure.v1'),
  grantReference: z.string(),
  versions: z.array(z.looseObject({ reference: z.string(), version: z.int() })),
});

/** The fields of `InternalVersionDocument` the access service relies on. */
const versionDocumentSchema = z.looseObject({
  declarationId: z.uuid(),
  version: z.int(),
  personId: z.uuid(),
});

const none = (): null => null;

/**
 * The declarations internal API through the client generated from its contract
 * (packages/schemas/internal/declarations.yaml → declarations-api.gen.ts via
 * `pnpm generate:api`), with the access service's own token (`declarations:internal`) and the
 * recipient (or the declarant) in `X-Acting-Subject`, whom declarations audits the read for.
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

  async renderDisclosure(request: DisclosureRequest): Promise<DisclosureDocument | null> {
    const disclosure = await this.declarations.call(
      (api) =>
        api.POST('/internal/v1/declarations/disclosures', {
          params: { header: { 'X-Acting-Subject': request.recipientSubject } },
          body: request,
        }),
      {
        status: 200,
        schema: disclosureSchema,
        otherwise: { 404: none, ...refusedWith('declarations', [400, 403]) },
      },
    );
    return disclosure as DisclosureDocument | null;
  }

  async fullDocument(
    declarationId: string,
    version: number,
    declarantSubject: string,
  ): Promise<VersionDocument | null> {
    const document = await this.declarations.call(
      (api) =>
        api.GET('/internal/v1/declarations/{declarationId}/versions/{version}/full-document', {
          params: {
            path: { declarationId, version },
            header: { 'X-Acting-Subject': declarantSubject },
          },
        }),
      {
        status: 200,
        schema: versionDocumentSchema,
        otherwise: { 404: none, ...refusedWith('declarations', [403]) },
      },
    );
    return document as VersionDocument | null;
  }
}
